// Uygulamanın bugün ÇALIŞAN temel akışları. Bunların hepsi her zaman
// geçmeli; biri kırmızıya dönerse bir değişiklik bir şeyi bozmuş demektir.
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE } from '../harness/seed.js'

test.describe('Temel akışlar', { tag: '@temel' }, () => {
  test('yanlış şifreyle giriş reddediliyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { login: false })
    await mert.page.getByPlaceholder('Kullanıcı adı').fill('Mert')
    await mert.page.getByPlaceholder('Şifre', { exact: true }).fill('yanlis-sifre')
    await mert.page.getByRole('button', { name: 'Giriş Yap' }).click()
    await expect(mert.page.getByText('Kullanıcı adı veya şifre hatalı.')).toBeVisible()
  })

  test('davet koduyla kayıt olup giriş yapılabiliyor', async ({ disco }) => {
    const page = (await disco.user('Yeni', { login: false })).page
    await page.getByRole('button', { name: 'Kayıt ol' }).click()
    await page.getByPlaceholder('Kullanıcı adı').fill('Yeni')
    await page.getByPlaceholder('Şifre (en az 6 karakter)').fill(PASSWORD)
    await page.getByPlaceholder('Davet kodu').fill(REGISTER_INVITE_CODE)
    await page.getByRole('button', { name: 'Kayıt Ol' }).click()
    await expect(page.getByText('Kayıt başarılı!')).toBeVisible()

    await page.getByPlaceholder('Şifre', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Giriş Yap' }).click()
    await expect(page.locator('.whoami')).toContainText('Yeni')
  })

  test('"Beni hatırla" sayfa yenilenince oturumu koruyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { rememberMe: true })
    await mert.page.reload()
    await expect(mert.page.locator('.whoami')).toContainText('Mert')
  })

  test('iki kişi aynı kanalda mesajlaşabiliyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await expect(mert.page.locator('.member-item--online', { hasText: 'Ece' })).toBeVisible()

    await mert.send('Selam Ece, sesli girelim mi?')
    await expect(ece.chat).toContainText('Selam Ece, sesli girelim mi?')
    await ece.send('Olur, geliyorum')
    await expect(mert.chat).toContainText('Olur, geliyorum')
  })

  test('iki kişi sese katılıyor, ses paketleri karşıya ulaşıyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')

    await mert.joinVoice()
    await ece.joinVoice()
    await expect(mert.peerTile('Ece')).toBeVisible()
    await expect(ece.peerTile('Mert')).toBeVisible()
    await expect.poll(() => observer.voiceUsernames()).toEqual(['Ece', 'Mert'])

    await mert.micOn()
    await ece.micOn()
    await mert.expectAudioPacketsArriving()
    await ece.expectAudioPacketsArriving()

    // H25: teşhis kayıtları varsayılan olarak kapalı; eskiden burada her
    // 2,5 saniyede kişi başı onlarca satır birikiyordu.
    await mert.page.waitForTimeout(3000)
    expect(mert.consoleLines.filter((line) => line.startsWith('[log]'))).toEqual([])
  })

  // Bugün mikrofonu ilk açışta karşı taraf duymuyor (H30); kapatıp açmak
  // düzeltiyor. Bu test, ses çalma yolunun (Web Audio, kişi başı ses
  // seviyesi) kendisinin çalıştığını güvenceye alıyor.
  test('mikrofonunu kapatıp açan kişi karşı taraftan duyuluyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await ece.joinVoice()
    await mert.micOn()
    await ece.micOn()
    await mert.expectAudioPacketsArriving()

    await ece.mediaButton('Mikrofonu kapat').click()
    await ece.micOn()
    await mert.expectHearingSomeone()
  })
})
