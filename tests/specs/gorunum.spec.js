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

  test('ses ayarları: seste giriş hassasiyeti çubuğu', async ({ disco }, testInfo) => {
    const mert = await disco.user('Mert', {
      storage: { voiceSettings: JSON.stringify({ autoSensitivity: false, thresholdDb: -45 }) },
    })
    await mert.useSyntheticMic(-20)
    await mert.openChannel('genel')
    await mert.joinVoice()
    await mert.micOn()
    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
    await expect(mert.page.locator('.level-meter--open')).toHaveCount(1)
    await shot(mert, testInfo, '24-ses-hassasiyet')
    await mert.page.getByRole('switch', { name: 'Otomatik ayarla' }).check()
    await mert.setSyntheticMicLevel(-50)
    await expect(mert.page.locator('.level-meter--open')).toHaveCount(0)
    await shot(mert, testInfo, '25-ses-hassasiyet-otomatik')
  })

  test('ekran paylaşımı: kalite penceresi ve yayını büyütüp sohbeti yanda tutma', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    const bora = await disco.user('Bora')
    for (const user of [mert, ece, bora]) {
      await user.openChannel('genel')
      await user.page.getByRole('button', { name: 'Sese katıl', exact: true }).click()
      await expect(user.leaveVoiceButton()).toBeVisible()
    }
    await mert.mediaButton('Ekranı paylaş').click()
    await mert.page.getByRole('dialog', { name: 'Ekranını paylaş' }).getByRole('radio', { name: '1080p' }).click()
    await shot(mert, testInfo, '26-ekran-paylas-penceresi')
    await mert.page.getByRole('button', { name: 'Ekranı seç ve paylaş' }).click()

    const screenTile = ece.page.locator('.tile--screen')
    await expect.poll(() => screenTile.locator('video').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)
    await screenTile.click()
    await expect(ece.page.locator('.stage-strip .tile')).toHaveCount(3)
    await shot(ece, testInfo, '27-yayin-odak')
  })

  test('sunucu rolleri: üye listesi, roller ve üyeler sayfası, rol ve kanal pencereleri', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)
    const serverId = disco.serverId
    const owner = await disco.client('Alganis')
    const { role: dj } = await owner.emitAck('create-role', {
      serverId,
      name: 'DJ',
      color: '#a98af7',
      hoist: true,
      permissions: { manageChannels: true, createInvites: true },
    })
    const { role: regular } = await owner.emitAck('create-role', { serverId, name: 'Müdavim', color: '#e6b04a', hoist: true })
    await owner.emitAck('set-member-roles', { serverId, username: 'Mert', roleIds: [dj.id] })
    for (const username of ['Ece', 'Bora']) await owner.emitAck('set-member-roles', { serverId, username, roleIds: [regular.id] })
    owner.close()

    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    for (const user of [alganis, mert, await disco.user('Ece'), await disco.user('Bora')]) await user.openChannel('genel')
    await expect(alganis.page.getByRole('heading', { name: 'Müdavim — 2' })).toBeVisible()
    await shot(alganis, testInfo, '28-roller-uye-listesi')

    await alganis.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    const nav = alganis.page.getByRole('navigation', { name: 'Ayar kategorileri' })
    await nav.getByRole('button', { name: 'Roller' }).click()
    await shot(alganis, testInfo, '29-roller-sayfasi')
    await alganis.page.locator('.settings-list-row', { hasText: 'DJ' }).getByRole('button', { name: 'Düzenle' }).click()
    await shot(alganis, testInfo, '30-rol-penceresi')
    await alganis.page.getByRole('dialog', { name: '“DJ” rolü' }).getByRole('button', { name: 'Vazgeç' }).click()
    await nav.getByRole('button', { name: 'Üyeler' }).click()
    await alganis.page.locator('.settings-list-row', { hasText: 'Ece' }).getByRole('button', { name: 'Roller' }).click()
    await shot(alganis, testInfo, '31-uyeler-sayfasi')

    await mert.channelButton('oyun').hover()
    await mert.page.getByRole('button', { name: 'oyun kanalını düzenle' }).click()
    await mert.page.getByRole('radio', { name: 'Seçtiğim roller' }).click()
    await mert.page.getByRole('dialog', { name: '#oyun kanalı' }).getByLabel('Müdavim').check()
    await shot(mert, testInfo, '32-kanal-duzenle')
  })

  test('durum ve etkinlik: üye listesinde oyun, özel durum, boşta, rahatsız etmeyin; durum menüsü', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)
    const ece = await disco.client('Ece')
    await ece.emitAck('set-custom-status', { text: 'yarın sınav var, akşam gelirim' })
    const bora = await disco.client('Bora')
    bora.socket.emit('set-activity', { name: 'VALORANT' })
    await bora.emitAck('set-status', { status: 'dnd' })
    const gozcu = await disco.client('Gozcu')
    gozcu.socket.emit('set-idle', { idle: true })

    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await expect(mert.page.locator('.member-item', { hasText: 'Bora' })).toContainText('VALORANT')
    await expect(mert.page.locator('.member-item', { hasText: 'Gozcu' }).locator('.status-dot--idle')).toHaveCount(1)
    await mert.page.getByRole('button', { name: /^Durumun:/ }).click()
    await shot(mert, testInfo, '33-durum-menusu')
  })

  test('özel mesajlar: arkadaşlar sayfası, konuşma, gelen arama', async ({ disco }, testInfo) => {
    // Mert'in arkadaşları: Ece (oyunda), Bora (özel durumlu); Gozcu'dan istek bekliyor.
    const mertClient = await disco.client('Mert')
    for (const friend of ['Ece', 'Bora']) {
      const client = await disco.client(friend)
      await client.emitAck('send-friend-request', { username: 'Mert' })
      await mertClient.emitAck('respond-friend-request', { username: friend, accept: true })
    }
    const ece = await disco.client('Ece')
    ece.socket.emit('set-activity', { name: 'League of Legends' })
    const bora = await disco.client('Bora')
    await bora.emitAck('set-custom-status', { text: 'mesaide, 7de dönerim' })
    await (await disco.client('Gozcu')).emitAck('send-friend-request', { username: 'Mert' })
    const { channelId } = await ece.emitAck('open-dm', { username: 'Mert' })
    await ece.emitAck('join-channel', { serverId: null, channelId })
    for (const text of ['bu akşam ranked var mı?', 'Bora da gelir dedi, **21.00** gibi']) {
      ece.socket.emit('send-message', { token: ece.token, text })
      await ece.nextEvent('new-message', (m) => m.text === text)
    }
    mertClient.close()

    const mert = await disco.user('Mert')
    await mert.page.getByRole('button', { name: /^Özel mesajlar/ }).click()
    await mert.page.getByRole('tab', { name: 'Tümü' }).click()
    await expect(mert.page.locator('.friend-row', { hasText: 'Ece' })).toContainText('League of Legends oynuyor')
    await shot(mert, testInfo, '34-arkadaslar')
    await mert.page.getByRole('list', { name: 'Konuşmalar' }).getByRole('button', { name: /Ece/ }).click()
    await expect(mert.chat).toContainText('ranked')
    await ece.emitAck('join-voice', { token: ece.token, channelId })
    await expect(mert.page.getByRole('alert').filter({ hasText: 'Ece seni arıyor' })).toBeVisible()
    await shot(mert, testInfo, '35-ozel-mesaj-arama')
  })

  test('arama sonuçları ve sabitlenmiş mesajlar paneli', async ({ disco }, testInfo) => {
    await insertChat(disco.mongoUri, disco.channels.genel, CHAT)
    await insertChat(disco.mongoUri, disco.channels.oyun, [
      { username: 'Bora', text: 'akşam turnuvada ben destek oynarım', minutesAgo: 30 },
    ])
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.page.getByRole('searchbox', { name: /içinde ara/ }).fill('akşam')
    await mert.page.keyboard.press('Enter')
    await expect(mert.page.getByRole('complementary', { name: 'Arama sonuçları' })).toContainText('turnuvada')
    await shot(mert, testInfo, '36-arama')
  })
})
