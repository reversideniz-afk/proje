// Görünüm: ana ekranların masaüstü ve telefon ekran görüntüleri. Tasarımı
// gözle kontrol etmek için; görüntüler test raporuna ekleniyor (npm run
// report).
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE, insertChat } from '../harness/seed.js'

async function shot(user, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`)
  await user.page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

const CHAT = [
  { username: 'Mert', text: 'akşam kim var? 9 gibi bir şeyler açalım mı', minutesAgo: 26 * 60 },
  { username: 'Ece', text: 'ben varım ama 9.30 olur ancak', minutesAgo: 25 * 60 },
  {
    username: 'Bora',
    text: 'ben de katılırım, kulaklığım şarj oluyor',
    minutesAgo: 40,
    replyTo: { username: 'Mert', text: 'akşam kim var? 9 gibi bir şeyler açalım mı' },
  },
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
  { username: 'Ece', text: 'tamamdır, **9.30** gibi oradayım. sunucu adresi `disco-lobi` değil mi?', minutesAgo: 3 },
]

test.describe('Görünüm', { tag: '@gorunum' }, () => {
  test('masaüstü: giriş, sohbet, ses sahnesi, ayarlar', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)

    const mert = await disco.user('Mert', { login: false })
    await shot(mert, testInfo, '01-giris')
    await mert.login()
    await shot(mert, testInfo, '02-kanal-secilmedi')
    await mert.openChannel('genel')
    await expect(mert.chat).toContainText('oradayım')
    await shot(mert, testInfo, '03-sohbet')

    await mert.chat.locator('.chat-message', { hasText: 'toplanıyoruz' }).hover()
    await shot(mert, testInfo, '04-mesaj-arac-cubugu')

    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await ece.micOn()
    await mert.joinVoice()
    await expect(mert.peerTile('Ece')).toBeVisible()
    // Işık sahte mikrofonun bip ritminde yanıp sönüyor: yandığı kareyi yakala.
    // Çekimden önce ve sonra hâlâ yanıyorsa fotoğrafta da yanıyor demektir.
    const speaking = () => mert.page.evaluate(() => !!document.querySelector('.tile.is-speaking'))
    for (let attempt = 0; attempt < 10; attempt++) {
      await mert.page.waitForFunction(() => !!document.querySelector('.tile.is-speaking'), null, {
        polling: 'raf',
        timeout: 15_000,
      })
      const path = testInfo.outputPath('05-ses-sahnesi.png')
      await mert.page.screenshot({ path })
      if (await speaking()) break
    }
    await testInfo.attach('05-ses-sahnesi', { path: testInfo.outputPath('05-ses-sahnesi.png'), contentType: 'image/png' })

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
    await expect(mert.chat).toContainText('oradayım')
    await shot(mert, testInfo, '13-telefon-sohbet')
    await mert.page.getByRole('button', { name: 'Sese katıl', exact: true }).click()
    await expect(mert.page.locator('.voice-stage')).toBeVisible()
    await shot(mert, testInfo, '14-telefon-ses')
  })

  test('davet: bağlantı oluşturma ve davetle gelenin katılma penceresi', async ({ disco }, testInfo) => {
    const alganis = await disco.user('Alganis')
    await alganis.page.locator('.sidebar-server-button').click()
    await alganis.page.getByRole('menuitem', { name: 'Arkadaşını davet et' }).click()
    const dialog = alganis.page.getByRole('dialog', { name: 'Test Sunucusu daveti' })
    await dialog.getByLabel('Kullanım').selectOption('5')
    await dialog.getByRole('button', { name: 'Yeni bağlantı oluştur' }).click()
    await expect(dialog.getByRole('status')).toContainText('0/5 kullanıldı')
    await shot(alganis, testInfo, '21-davet-olustur')
    const link = await dialog.getByLabel('Davet bağlantısı').inputValue()

    const client = await disco.client()
    await client.emitAck('register', { username: 'Yolcu', password: PASSWORD, inviteCode: REGISTER_INVITE_CODE })
    client.close()
    const code = link.split('/davet/')[1]
    const yolcu = await disco.user('Yolcu', { login: false, path: `/?davet=${code}` })
    await expect(yolcu.page.getByRole('status')).toContainText('Test Sunucusu')
    await shot(yolcu, testInfo, '22-davet-giris')
    await yolcu.login()
    await expect(yolcu.page.getByRole('dialog', { name: 'Sunucu daveti' })).toContainText('5 üye')
    await shot(yolcu, testInfo, '23-davet-katil')
  })
})
