// Testlerin kullandığı ortam. Her test şunlarla başlar:
//   - bellek içi MongoDB'de, örnek verilerle doldurulmuş YEPYENİ bir veritabanı,
//   - o veritabanına bağlı, değiştirilmemiş server/server.js süreci,
//   - tarayıcıyla sunucu arasında bağlantı kesmeye yarayan bir vekil.
// Gerçek Render sunucusuna ve Atlas veritabanına hiçbir zaman bağlanılmaz.
import { test as base, expect } from '@playwright/test'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import { instrumentPage } from './instrument.js'
import { clientBuildDir } from './paths.js'
import { createProxy } from './proxy.js'
import { REGISTER_INVITE_CODE, seedDatabase } from './seed.js'
import { ServerProcess } from './server-process.js'
import { TestClient } from './socket-client.js'
import { startStaticServer } from './static-server.js'
import { UserSession } from './user-session.js'

// MongoDB 7.0.24 ikili dosyası ilk çalıştırmada bir kez indirilir
// (~600 MB, kullanıcı önbelleğine), sonraki çalıştırmalarda hazır gelir.
const MONGODB_VERSION = '7.0.24'

export const test = base.extend({
  harness: [
    async ({}, use) => {
      const mongo = await MongoMemoryServer.create({ binary: { version: MONGODB_VERSION } })
      // appProxy: tarayıcıların bağlandığı adres (istemci bu porta göre derlendi).
      const appProxy = createProxy()
      await appProxy.listen(Number(process.env.DISCO_PROXY_PORT))
      // clientProxy: testlerin protokol istemcileri için; dropAll'dan etkilenmez.
      const clientProxy = createProxy()
      const clientProxyPort = await clientProxy.listen()
      const web = await startStaticServer(clientBuildDir)
      let dbCounter = 0

      await use({
        async newEnvironment() {
          const mongoUri = mongo.getUri(`disco-test-${++dbCounter}`)
          const seed = await seedDatabase(mongoUri)
          const server = new ServerProcess({
            mongoUri,
            // LINK_PREVIEW_ALLOW_LOOPBACK: bağlantı önizlemesi testlerin yerel
            // sitesine (127.0.0.1) gidebilsin; sadece ALLOW_TEST_TOKENS ile
            // birlikte geçerli (bkz. server/lib/linkPreview.js).
            extraEnv: { REGISTER_INVITE_CODE, ALLOW_TEST_TOKENS: 'true', LINK_PREVIEW_ALLOW_LOOPBACK: 'true' },
          })
          const pointProxiesAt = (port) => {
            appProxy.setTarget(port)
            clientProxy.setTarget(port)
          }
          pointProxiesAt(await server.start())
          return {
            ...seed,
            mongoUri,
            server,
            clientUrl: web.url,
            socketUrl: `http://127.0.0.1:${clientProxyPort}`,
            // İnternetin bir an gidip gelmesi: tarayıcıların bütün bağlantıları kopar.
            dropConnections: () => appProxy.dropAll(),
            // İnternet bir süre tamamen gider (bkz. proxy.block).
            goOffline: () => appProxy.block(),
            goOnline: () => appProxy.unblock(),
            // Render'ın deploy ya da uyku sonrası yeniden başlaması.
            async restartServer() {
              pointProxiesAt(await server.restart())
            },
            async dispose() {
              await server.stop()
              appProxy.dropAll()
              clientProxy.dropAll()
            },
          }
        },
      })

      await web.close()
      await appProxy.close()
      await clientProxy.close()
      // Bellek içi MongoDB bu makinede arada bir 10 saniyede kapanmıyor;
      // testler bitmiş oluyor, kapanış gecikmesi çalıştırmayı kırmızıya
      // çevirmesin.
      await mongo.stop().catch((err) => console.warn('[düzenek] MongoDB kapanırken:', err.message))
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  disco: async ({ harness, browser }, use, testInfo) => {
    const env = await harness.newEnvironment()
    const users = []
    const clients = []

    const disco = {
      ...env,

      // Tarayıcıda yeni bir kullanıcı açar (kendi çerezleri/localStorage'ı ile)
      // ve varsayılan olarak arayüzden giriş yaptırır.
      // storage: sayfa açılmadan önce localStorage'a yazılacak değerler.
      // desktopApp: Electron'un preload köprüsünü (window.electronAPI) taklit
      // eder; yakınlaştırma çağrıları window.__disco.zoomFactors'a düşer.
      // path: uygulamanın açılacağı adres (ör. "/?davet=KOD").
      // phone: dokunmatik telefon ekranı (390x844, dokunma olayları açık).
      async user(name, { login = true, rememberMe = false, viewport, storage, desktopApp, path, phone } = {}) {
        const context = await browser.newContext({
          permissions: ['microphone', 'camera'],
          locale: 'tr-TR',
          viewport: viewport || (phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }),
          ...(phone ? { hasTouch: true, isMobile: true } : {}),
        })
        await context.addInitScript(instrumentPage)
        if (desktopApp) {
          await context.addInitScript(() => {
            window.__disco.zoomFactors = []
            window.electronAPI = {
              setZoomFactor: (factor) => window.__disco.zoomFactors.push(factor),
              isFullscreen: async () => false,
              onFullscreenChange: () => () => {},
              toggleFullscreen: () => {},
            }
          })
        }
        if (storage) {
          await context.addInitScript((items) => {
            for (const [key, value] of Object.entries(items)) window.localStorage.setItem(key, value)
          }, storage)
        }
        const page = await context.newPage()
        const session = new UserSession(name, context, page)
        session.consoleLines = []
        page.on('console', (msg) => session.consoleLines.push(`[${msg.type()}] ${msg.text()}`))
        page.on('pageerror', (err) => session.consoleLines.push(`[sayfa hatası] ${err.message}`))
        users.push(session)
        await page.goto(new URL(path || '/', env.clientUrl).href)
        if (login) await session.login({ rememberMe })
        return session
      },

      // Tarayıcısız protokol istemcisi; kullanıcı adı verilirse giriş yapar.
      async client(username, options) {
        const client = new TestClient(env.socketUrl, options)
        clients.push(client)
        await client.connected()
        if (username) await client.login(username)
        return client
      },

      // Sunucunun gözünden bir kanalı izleyen gözlemci (Gozcu hesabı).
      // TEST_BYPASS belirteci sunucu yeniden başlasa bile geçerli kalıyor.
      async observer(channelName) {
        const client = new TestClient(env.socketUrl)
        clients.push(client)
        client.token = 'TEST_BYPASS:Gozcu'
        client.rejoinOnReconnect()
        await client.connected()
        await client.joinChannel(env.serverId, env.channels[channelName])
        return client
      },
    }

    await use(disco)

    // Kanıt: her kullanıcının son ekranı, tarayıcı konsolu ve sunucu kayıtları
    // test raporuna ekleniyor (npm run report ile görülebilir).
    for (const session of users) {
      if (!session.page.isClosed()) {
        const screenshot = await session.page.screenshot().catch(() => null)
        if (screenshot) {
          await testInfo.attach(`${session.name}-ekran.png`, { body: screenshot, contentType: 'image/png' })
        }
      }
      await testInfo.attach(`${session.name}-konsol.txt`, {
        body: session.consoleLines.join('\n'),
        contentType: 'text/plain',
      })
    }
    await testInfo.attach('sunucu-kayitlari.txt', {
      body: env.server.logs.join('\n'),
      contentType: 'text/plain',
    })

    clients.forEach((client) => client.close())
    await Promise.all(users.map((session) => session.context.close().catch(() => {})))
    await env.dispose()

    // Güvenlik politikasının (index.html'deki CSP) engellediği bir şey varsa
    // uygulamanın bir parçası çalışmıyor demektir (ör. yazı tipi, avatar):
    // test başka açıdan geçse de kırmızı olsun.
    const blocked = users.flatMap((session) =>
      session.consoleLines.filter((line) => line.includes('Content Security Policy')).map((line) => `${session.name}: ${line}`)
    )
    if (blocked.length > 0) {
      throw new Error(`Güvenlik politikası bir şeyi engelledi:\n${blocked.map((line) => line.slice(0, 300)).join('\n')}`)
    }
  },
})

export { expect }
