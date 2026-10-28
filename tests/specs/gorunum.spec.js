// Görünüm: ana ekranların masaüstü ve telefon ekran görüntüleri. Tasarımı
// gözle kontrol etmek için; görüntüler test raporuna ekleniyor (npm run
// report).
import { test, expect } from '../harness/fixtures.js'
import { insertChat } from '../harness/seed.js'

async function shot(user, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`)
  await user.page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

const CHAT = [
  { username: 'Mert', text: 'akşam kim var? 9 gibi bir şeyler açalım mı', minutesAgo: 26 * 60 },
  { username: 'Ece', text: 'ben varım ama 9.30 olur ancak', minutesAgo: 25 * 60 },
  { username: 'Bora', text: 'ben de katılırım, kulaklığım şarj oluyor', minutesAgo: 40 },
  { username: 'Bora', text: 'Mert sen ekranı paylaşır mısın?', minutesAgo: 39 },
  {
    username: 'Mert',
    text: '@all bu akşam genel kanalında toplanıyoruz.\nEkran paylaşımını da deneyelim.',
    minutesAgo: 12,
    reactions: [
      { emoji: '👍', username: 'Ece' },
      { emoji: '👍', username: 'Bora' },
      { emoji: '🎉', username: 'Ece' },
    ],
  },
  { username: 'Ece', text: 'tamamdır, geliyorum', minutesAgo: 3 },
]

test.describe('Görünüm', { tag: '@gorunum' }, () => {
  test('masaüstü: giriş, sohbet, ses sahnesi, ayarlar', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)

    const mert = await disco.user('Mert', { login: false })
    await shot(mert, testInfo, '01-giris')
    await mert.login()
    await shot(mert, testInfo, '02-kanal-secilmedi')
    await mert.openChannel('genel')
    await expect(mert.chat).toContainText('tamamdır')
    await shot(mert, testInfo, '03-sohbet')

    await mert.chat.locator('.chat-message', { hasText: 'toplanıyoruz' }).hover()
    await shot(mert, testInfo, '04-mesaj-arac-cubugu')

    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await ece.micOn()
    await mert.joinVoice()
    await expect(mert.peerTile('Ece')).toBeVisible()
    await expect(mert.page.locator('.tile.is-speaking')).toBeVisible({ timeout: 15_000 })
    await shot(mert, testInfo, '05-ses-sahnesi')

    await mert.openChannel('oyun')
    await shot(mert, testInfo, '06-baska-kanalda-ses')

    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await shot(mert, testInfo, '07-ayarlar')
    await mert.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
    await shot(mert, testInfo, '08-ayarlar-ses')
  })

  test('telefon: kanal listesi, sohbet, ses', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)
    const viewport = { width: 390, height: 844 }
    const mert = await disco.user('Mert', { viewport })
    await shot(mert, testInfo, '11-telefon-bos')
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await shot(mert, testInfo, '12-telefon-cekmece')
    await mert.channelButton('genel').click()
    await expect(mert.chat).toContainText('tamamdır')
    await shot(mert, testInfo, '13-telefon-sohbet')
    await mert.page.getByRole('button', { name: 'Sese katıl', exact: true }).click()
    await expect(mert.page.locator('.voice-stage')).toBeVisible()
    await shot(mert, testInfo, '14-telefon-ses')
  })
})
