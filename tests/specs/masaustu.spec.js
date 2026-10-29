// Gerçek masaüstü uygulaması (Electron) ile testler. Uygulama, test için
// derlenen istemciyi açıyor (DISCO_APP_URL) ve aynı yerel sunucuya bağlanıyor.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from '@playwright/test'
import { test, expect } from '../harness/fixtures.js'
import { clientBuildDir, desktopDir, requireFromDesktop } from '../harness/paths.js'
import { UserSession } from '../harness/user-session.js'

const electronBinary = requireFromDesktop('electron')

// VS Code gibi Electron tabanlı araçlar ELECTRON_RUN_AS_NODE=1 bırakabiliyor;
// o zaman electron.exe uygulama yerine düz Node olarak çalışıyor.
// DISCO_TEST_HOOKS: ana süreç bas-konuş ve tepsiyi testlere açıyor.
function desktopAppEnv(disco, appUrl = disco.clientUrl) {
  const env = { ...process.env, DISCO_APP_URL: appUrl, DISCO_TEST_HOOKS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

// Gerçek kamera ve mikrofon yerine Chromium'un sahte cihazları.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

// extraArgs: uygulamaya verilen ek komut satırı (ör. bir disco:// bağlantısı).
// appUrl: varsayılan, test sunucusundaki istemci; paketlenmiş uygulama gibi
// dosyadan (file://) açmak için derlenen istemcinin index.html'i.
async function launchDesktopApp(disco, userDataDir, extraArgs = [], appUrl = disco.clientUrl) {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [...FAKE_MEDIA, `--user-data-dir=${userDataDir}`, desktopDir, ...extraArgs],
    env: desktopAppEnv(disco, appUrl),
  })
  const page = await app.firstWindow()
  // Pencerenin konsolu test raporuna ekleniyor (bkz. afterEach).
  consoleLines = []
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`[sayfa hatası] ${err.message}`))
  return { app, page }
}

let consoleLines = []
test.afterEach(async ({}, testInfo) => {
  await testInfo.attach('masaustu-konsol.txt', { body: consoleLines.join('\n'), contentType: 'text/plain' })
  consoleLines = []
})

const windowVisible = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())

test.describe('Masaüstü uygulaması', { tag: '@masaustu' }, () => {
  test('H19: açılıyor, giriş yapılıyor, kanala giriliyor', async ({ disco }, testInfo) => {
    const { app, page } = await launchDesktopApp(disco, testInfo.outputPath('kullanici-verisi'))
    try {
      const mert = new UserSession('Mert', app.context(), page)
      await mert.login()
      await mert.openChannel('genel')
      expect(await app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBe('1.1.0')
    } finally {
      await app.close()
    }
  })

  test('H19: yeni pencere açılmıyor, web linkleri varsayılan tarayıcıda açılıyor', async ({ disco }, testInfo) => {
    const { app, page } = await launchDesktopApp(disco, testInfo.outputPath('kullanici-verisi'))
    try {
      // Varsayılan tarayıcıyı gerçekten açmasın, sadece kaydetsin.
      await app.evaluate(({ shell }) => {
        globalThis.openedExternally = []
        shell.openExternal = async (url) => {
          globalThis.openedExternally.push(url)
        }
      })
      await page.evaluate(() => {
        window.open('https://ornek.invalid/sayfa')
        window.open('data:text/html,<h1>merhaba</h1>')
      })
      await expect.poll(() => app.evaluate(() => globalThis.openedExternally)).toEqual([
        'https://ornek.invalid/sayfa',
      ])
      expect(app.windows()).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('H19: ikinci kez açılınca yeni kopya başlamıyor', async ({ disco }, testInfo) => {
    const userDataDir = testInfo.outputPath('kullanici-verisi')
    const { app } = await launchDesktopApp(disco, userDataDir)
    try {
      const second = spawn(electronBinary, [`--user-data-dir=${userDataDir}`, desktopDir], {
        env: desktopAppEnv(disco),
        stdio: 'ignore',
      })
      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          second.kill()
          reject(new Error('İkinci kopya 15 saniyede kapanmadı'))
        }, 15_000)
        second.once('exit', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })
      expect(exitCode).toBe(0)
      expect(app.windows()).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  test('pencereyi kapatınca Disco tepside çalışmaya devam ediyor, seste kalınıyor', async ({ disco }, testInfo) => {
    const observer = await disco.observer('genel')
    const { app, page } = await launchDesktopApp(disco, testInfo.outputPath('kullanici-verisi'))
    try {
      const mert = new UserSession('Mert', app.context(), page)
      await mert.login()
      await mert.openChannel('genel')
      await mert.joinVoice()
      await expect.poll(() => observer.voiceUsernames()).toEqual(['Mert'])

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await expect.poll(() => windowVisible(app)).toBe(false)
      expect(await app.evaluate(() => globalThis.discoTest.getTray().isDestroyed())).toBe(false)
      // Sunucunun gözünde hâlâ seste.
      await page.waitForTimeout(1500)
      expect(observer.voiceUsernames()).toEqual(['Mert'])

      // Tepsi simgesine tıklayınca geri geliyor.
      await app.evaluate(() => globalThis.discoTest.getTray().emit('click'))
      await expect.poll(() => windowVisible(app)).toBe(true)

      // Ayar kapatılınca pencereyi kapatmak uygulamayı kapatıyor.
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
      await page.getByRole('button', { name: 'Masaüstü' }).click()
      await page.getByRole('switch', { name: /Kapatınca arka planda/ }).uncheck()
      const closed = app.waitForEvent('close')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await closed
    } finally {
      await app.close().catch(() => {})
    }
  })

  test('H28: bas-konuş Disco arka plandayken de çalışıyor', async ({ disco }, testInfo) => {
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    await ece.emitAck('join-voice', { token: ece.token, channelId: disco.channels.genel })

    const { app, page } = await launchDesktopApp(disco, testInfo.outputPath('kullanici-verisi'))
    try {
      const mert = new UserSession('Mert', app.context(), page)
      await mert.login()
      await mert.openChannel('genel')
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
      await page.getByRole('button', { name: 'Tuş atamaları' }).click()
      await page.getByRole('button', { name: 'Bas-konuş tuşu ata' }).click()
      await page.keyboard.press('KeyV')
      await expect(page.locator('.settings-key')).toHaveText('V')
      await page.keyboard.press('Escape')
      await expect(mert.page.locator('.user-panel')).toContainText('Bas-konuş: V')

      await mert.joinVoice()
      await expect.poll(() => ece.received('voice-user-joined').length).toBe(1)

      // Pencere arka planda (tepside); tuşa işletim sistemi seviyesinde basılıyor.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      await expect.poll(() => windowVisible(app)).toBe(false)
      const keycodeV = await app.evaluate(() => globalThis.discoTest.keycodeFor('KeyV'))
      const opened = ece.nextEvent('user-state-update', ({ state }) => state.muted === false)
      await app.evaluate((_electron, keycode) => globalThis.discoTest.pushToTalk.uIOhook.emit('keydown', { keycode }), keycodeV)
      await opened
      const closed = ece.nextEvent('user-state-update', ({ state }) => state.muted === true)
      await app.evaluate((_electron, keycode) => globalThis.discoTest.pushToTalk.uIOhook.emit('keyup', { keycode }), keycodeV)
      await closed

      // Sesten çıkınca klavye kancası da kapanıyor: tuş artık bir şey yapmıyor.
      await app.evaluate(() => globalThis.discoTest.getTray().emit('click'))
      await mert.leaveVoiceButton().click()
      await expect
        .poll(() => app.evaluate(() => globalThis.discoTest.pushToTalk.isRunning()))
        .toBe(false)
    } finally {
      await app.close().catch(() => {})
    }
  })

  test('paketlenmiş uygulamadaki gibi dosyadan açılınca da mikrofon ses kapısından geçiyor', async ({ disco }, testInfo) => {
    const appUrl = pathToFileURL(path.join(clientBuildDir, 'index.html')).href
    const { app, page } = await launchDesktopApp(disco, testInfo.outputPath('kullanici-verisi'), [], appUrl)
    try {
      expect(page.url()).toMatch(/^file:/)
      const mert = new UserSession('Mert', app.context(), page)
      await mert.login()
      await mert.openChannel('genel')
      await mert.joinVoice()
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
      await page.getByRole('button', { name: 'Ses ve görüntü' }).click()
      await expect(page.getByText('Seste olduğun için seviye canlı gösteriliyor.')).toBeVisible()
      const meter = page.getByRole('meter', { name: 'Mikrofon seviyesi' })
      await expect(meter).not.toHaveAttribute('aria-valuetext', 'Ölçülmüyor')
      expect(consoleLines.filter((line) => line.includes('ses kapısı kurulamadı'))).toEqual([])
    } finally {
      await app.close().catch(() => {})
    }
  })

  test('disco://davet bağlantısı uygulamayı açınca da, uygulama açıkken de davet penceresini açıyor', async ({ disco }, testInfo) => {
    const owner = await disco.client('Alganis')
    const { code } = (await owner.emitAck('create-invite', { serverId: disco.serverId })).invite
    const link = `disco://davet/${code}`
    const userDataDir = testInfo.outputPath('kullanici-verisi')
    const { app, page } = await launchDesktopApp(disco, userDataDir, [link])
    try {
      const mert = new UserSession('Mert', app.context(), page)
      await mert.login()
      const dialog = page.getByRole('dialog', { name: 'Sunucu daveti' })
      await expect(dialog).toContainText('Test Sunucusu')
      // Mert zaten üye: katılmak yerine sunucuya gidiyor.
      await dialog.getByRole('button', { name: 'Sunucuya git' }).click()
      await expect(dialog).toHaveCount(0)

      // Uygulama açıkken bağlantıya tıklamak: ikinci kopya kodu açık olana verip kapanıyor.
      const second = spawn(electronBinary, [`--user-data-dir=${userDataDir}`, desktopDir, link], {
        env: desktopAppEnv(disco),
        stdio: 'ignore',
      })
      await new Promise((resolve) => second.once('exit', resolve))
      await expect(dialog).toContainText('Test Sunucusu')
      expect(app.windows()).toHaveLength(1)
    } finally {
      await app.close().catch(() => {})
    }
  })
})
