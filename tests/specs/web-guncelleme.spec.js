// Web/PWA sürümünün güncellenmesi. Uygulama kabuğu service worker'ın
// önbelleğinden açılıyor; Render'a yeni sürüm gelince ekrandaki eski sayfa
// kendiliğinden yenilenmiyordu, telefonda günlerce eski sürüm kalıyordu
// (2.0.0'dan sonra görüldü). Şimdi uygulamaya dönülünce yeni sürüm
// aranıyor; az önce açıldıysa sayfa yenileniyor, seste ise "güncelleme
// hazır" düğmesi çıkıyor.
import fs from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../harness/fixtures.js'
import { instrumentPage } from '../harness/instrument.js'
import { clientBuildDir } from '../harness/paths.js'
import { startStaticServer } from '../harness/static-server.js'
import { UserSession } from '../harness/user-session.js'

// İstemcinin bir kopyası ayrı bir adresten sunuluyor: sw.js'i değiştirmek
// "yeni sürüm yayınlandı" demek, diğer testlerin kopyası etkilenmesin.
async function servedCopy(testInfo) {
  const dir = testInfo.outputPath('istemci')
  await fs.cp(clientBuildDir, dir, { recursive: true })
  const web = await startStaticServer(dir)
  return {
    ...web,
    publishNewVersion: () => fs.appendFile(path.join(dir, 'sw.js'), `\n// yeni sürüm ${Date.now()}\n`),
  }
}

async function openApp(browser, url, name) {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'], locale: 'tr-TR' })
  await context.addInitScript(instrumentPage)
  const page = await context.newPage()
  await page.goto(url)
  // İlk açılışta service worker kuruluyor ve sayfayı devralıyor.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.evaluate(() => {
    window.__eskiSayfa = true
  })
  return new UserSession(name, context, page)
}

// Kişi uygulamaya geri dönüyor (telefonda arka plandan öne gelmek).
// Sayfa yenilenirse 'yenilendi' döner.
const returnToApp = (page) =>
  page
    .evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      return window.__eskiSayfa ? 'eski sayfa' : 'yenilendi'
    })
    .catch(() => 'yenileniyor')

test.describe('Web sürümü güncellemesi', { tag: '@faz5' }, () => {
  test('uygulama az önce açıldıysa yeni sürümle kendiliğinden yenileniyor', async ({ disco, browser }, testInfo) => {
    const copy = await servedCopy(testInfo)
    const user = await openApp(browser, copy.url, 'Mert')
    try {
      await copy.publishNewVersion()
      await expect.poll(() => returnToApp(user.page), { timeout: 20_000 }).toBe('yenilendi')
      await expect(user.page.getByLabel('Kullanıcı adı')).toBeVisible()
    } finally {
      await user.context.close()
      await copy.close()
    }
  })

  test('seste kimseyi koparmıyor: "güncelleme hazır" düğmesi çıkıyor, basınca yenileniyor', async ({ disco, browser }, testInfo) => {
    const copy = await servedCopy(testInfo)
    const mert = await openApp(browser, copy.url, 'Mert')
    try {
      await mert.login()
      await mert.openChannel('genel')
      await mert.joinVoice()

      await copy.publishNewVersion()
      const ready = mert.page.getByRole('button', { name: 'Güncelleme hazır, yenile' })
      await expect
        .poll(async () => (await returnToApp(mert.page)) === 'eski sayfa' && (await ready.isVisible()), { timeout: 20_000 })
        .toBe(true)
      await expect(mert.leaveVoiceButton()).toBeVisible()

      await ready.click()
      await expect.poll(() => returnToApp(mert.page), { timeout: 20_000 }).toBe('yenilendi')
    } finally {
      await mert.context.close()
      await copy.close()
    }
  })
})
