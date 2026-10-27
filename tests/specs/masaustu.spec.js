// Gerçek masaüstü uygulaması (Electron) ile testler. Uygulama, test için
// derlenen istemciyi açıyor (DISCO_APP_URL) ve aynı yerel sunucuya bağlanıyor.
import { spawn } from 'node:child_process'
import { _electron as electron } from '@playwright/test'
import { test, expect } from '../harness/fixtures.js'
import { desktopDir, requireFromDesktop } from '../harness/paths.js'
import { UserSession } from '../harness/user-session.js'

const electronBinary = requireFromDesktop('electron')

// VS Code gibi Electron tabanlı araçlar ELECTRON_RUN_AS_NODE=1 bırakabiliyor;
// o zaman electron.exe uygulama yerine düz Node olarak çalışıyor.
function desktopAppEnv(disco) {
  const env = { ...process.env, DISCO_APP_URL: disco.clientUrl }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function launchDesktopApp(disco, userDataDir) {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [`--user-data-dir=${userDataDir}`, desktopDir],
    env: desktopAppEnv(disco),
  })
  const page = await app.firstWindow()
  return { app, page }
}

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
})
