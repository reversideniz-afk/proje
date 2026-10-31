// Faz 1 (ses ve oturum güvenilirliği) hatalarının kalıcı testleri. Her biri
// Disco Gelişim Raporu'ndaki bir hatanın (H1, H2…) doğru davranışını
// tarif ediyor; hepsi Faz 1'de düzeltildi ve artık geri dönmelerine karşı
// koruma görevi görüyor.
import { createHash } from 'node:crypto'
import { test, expect } from '../harness/fixtures.js'
import { insertLegacySession, listSessionTokens } from '../harness/seed.js'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const names =(members) => (members?.online || []).map((m) => m.username).sort()
const voiceNames = (members) =>
  (members?.online || [])
    .filter((m) => m.inVoice)
    .map((m) => m.username)
    .sort()

async function mertVeEceSeste(disco, { mic = false } = {}) {
  const mert = await disco.user('Mert')
  const ece = await disco.user('Ece')
  await mert.openChannel('genel')
  await ece.openChannel('genel')
  await mert.joinVoice()
  await ece.joinVoice()
  await expect(mert.peerTile('Ece')).toBeVisible()
  await expect(ece.peerTile('Mert')).toBeVisible()
  if (mic) {
    await mert.micOn()
    await ece.micOn()
    await mert.expectAudioPacketsArriving()
    await ece.expectAudioPacketsArriving()
  }
  return { mert, ece }
}

test.describe('Faz 1: ses ve oturum', { tag: '@faz1' }, () => {
  test('H30: mikrofonunu ilk kez açan kişi karşı taraftan duyuluyor', async ({ disco }) => {
    const { mert, ece } = await mertVeEceSeste(disco, { mic: true })
    await mert.expectHearingSomeone()
    await ece.expectHearingSomeone()
  })

  test('H1: kısa bir bağlantı kopmasından sonra ikisi de seste kalıyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const { mert, ece } = await mertVeEceSeste(disco, { mic: true })
    await expect.poll(() => observer.voiceUsernames()).toEqual(['Ece', 'Mert'])

    const mark = observer.mark()
    disco.dropConnections()
    // Sunucu kopmayı gördü...
    await expect
      .poll(() => observer.membersSince(mark).some((m) => !voiceNames(m).includes('Mert')))
      .toBe(true)
    // ...doğru davranış: yeniden bağlanınca ikisi de kendiliğinden sese döner,
    // eski bağlantılar kapanır ve ses yeni bağlantılardan akar.
    await expect
      .poll(() => voiceNames(observer.latestMembersSince(mark)), { timeout: 20_000 })
      .toEqual(['Ece', 'Mert'])
    await mert.expectAudioFromEachPeer(1)
    await ece.expectAudioFromEachPeer(1)
    await mert.expectHearingSomeone()
    await ece.expectHearingSomeone()
  })

  test('H1: aynı kişi ikinci kez sese girince eski ses kaydı çıkarılıyor', async ({ disco }) => {
    const eski = await disco.client('Mert')
    const yeni = await disco.client('Mert')
    const ece = await disco.client('Ece')
    for (const client of [eski, yeni, ece]) {
      await client.joinChannel(disco.serverId, disco.channels.genel)
    }
    await eski.emitAck('join-voice', { token: eski.token, channelId: disco.channels.genel })

    const replaced = eski.nextEvent('voice-ended')
    const response = await yeni.emitAck('join-voice', { token: yeni.token, channelId: disco.channels.genel })
    expect(response.success).toBe(true)
    await replaced

    const existing = ece.nextEvent('existing-voice-users')
    await ece.emitAck('join-voice', { token: ece.token, channelId: disco.channels.genel })
    expect((await existing).map((u) => u.socketId)).toEqual([yeni.socket.id])
  })

  test('1.1.0 istemcisi sese alınmıyor, sohbette güncellemesi söyleniyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const eski = await disco.client('Bora')
    const ece = await disco.client('Ece')
    for (const client of [mert, eski, ece]) await client.joinChannel(disco.serverId, disco.channels.genel)
    await mert.emitAck('join-voice', { token: mert.token, channelId: disco.channels.genel })

    // 1.1.0 sese channelId'siz giriyordu; bağlantı düzeni yeni istemcilerle
    // anlaşamadığı için sessizce bozuk bir sese girmesin.
    // Masaüstü uygulaması dosyadan açılıyor (web adresi yok): Ayarlar'dan
    // güncellemesi söyleniyor.
    const notice = eski.nextEvent('new-message')
    const response = await eski.emitAck('join-voice', { token: eski.token })
    expect(response.success).toBe(false)
    expect(await notice).toMatchObject({ username: 'Sistem', text: expect.stringContaining('Güncellemeleri kontrol et') })

    // Web ve telefonda eski sürüm önbellekteki kopya: yeniden açması yetiyor.
    const eskiWeb = await disco.client('Bora', { headers: { origin: 'http://127.0.0.1:5173' } })
    await eskiWeb.joinChannel(disco.serverId, disco.channels.genel)
    const webNotice = eskiWeb.nextEvent('new-message')
    expect((await eskiWeb.emitAck('join-voice', { token: eskiWeb.token })).success).toBe(false)
    expect((await webNotice).text).toContain('kapatıp yeniden aç')

    const existing = ece.nextEvent('existing-voice-users')
    await ece.emitAck('join-voice', { token: ece.token, channelId: disco.channels.genel })
    expect((await existing).map((u) => u.username)).toEqual(['Mert'])
  })

  test('H1: sesteyken başka kanala bakarken kopan kişi sesin olduğu kanala döner', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const { mert } = await mertVeEceSeste(disco)
    await mert.openChannel('oyun')
    await expect(mert.voicePanel()).toContainText('#genel')

    const mark = observer.mark()
    disco.dropConnections()
    await expect
      .poll(() => observer.membersSince(mark).some((m) => !voiceNames(m).includes('Mert')))
      .toBe(true)
    await expect
      .poll(() => voiceNames(observer.latestMembersSince(mark)), { timeout: 20_000 })
      .toEqual(['Ece', 'Mert'])
    // Ekranda hâlâ #oyun açık.
    await expect(mert.channelTitle()).toHaveText('oyun')
  })

  test('H2: sunucu yeniden başlayınca oturum ve kanal korunuyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')

    const mark = observer.mark()
    await disco.restartServer()
    await expect
      .poll(() => names(observer.latestMembersSince(mark)), { timeout: 20_000 })
      .toEqual(['Ece', 'Gozcu', 'Mert'])
    await expect(ece.page.getByText('Önce giriş yapman gerekiyor.')).toHaveCount(0)
    await ece.send('Sunucu yeniden başladı ama buradayız')
    await expect(mert.chat).toContainText('Sunucu yeniden başladı ama buradayız')
  })

  test('H2: sunucu yeniden başlayınca seste olanlar sese geri dönüyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const { mert, ece } = await mertVeEceSeste(disco, { mic: true })

    const mark = observer.mark()
    await disco.restartServer()
    await expect
      .poll(() => voiceNames(observer.latestMembersSince(mark)), { timeout: 20_000 })
      .toEqual(['Ece', 'Mert'])
    await mert.expectHearingSomeone()
    await ece.expectHearingSomeone()
  })

  test('H2: oturum anahtarı veritabanında özet olarak duruyor, eski kayıtlar da çalışıyor', async ({ disco }) => {
    // Canlıdaki "beni hatırla" kayıtları anahtarın kendisini saklıyor;
    // güncellemeden sonra arkadaşların yeniden giriş yapmak zorunda kalmamalı.
    const legacyToken = '3f2b1c0e-1111-4222-8333-944455556666'
    await insertLegacySession(disco.mongoUri, 'Mert', legacyToken)
    const mert = await disco.user('Mert', {
      login: false,
      storage: { rememberedSessionToken: legacyToken },
    })
    await expect(mert.page.locator('.whoami')).toContainText('Mert')
    expect(await listSessionTokens(disco.mongoUri)).toEqual([sha256(legacyToken)])

    // Yeni girişler de sadece özetiyle kaydediliyor.
    const ece = await disco.client('Ece')
    const tokens = await listSessionTokens(disco.mongoUri)
    expect(tokens).toContain(sha256(ece.token))
    expect(tokens).not.toContain(ece.token)
  })

  test('H2: çıkış yapılan oturum, sunucu yeniden başlasa da geçersiz', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const stillValid = async () => {
      const probe = await disco.client()
      const response = await probe.emitAck('server-channels', { token: mert.token, serverId: disco.serverId })
      probe.close()
      return response.success
    }
    expect(await stillValid()).toBe(true)
    mert.socket.emit('logout', { token: mert.token })
    await expect.poll(stillValid).toBe(false)
    await disco.restartServer()
    expect(await stillValid()).toBe(false)
  })

  test('H31: ekran paylaşımı sürerken sese giren kişi paylaşımı görüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await mert.shareScreen()
    await expect(mert.mediaButton('Ekran paylaşımını durdur')).toBeVisible()

    await ece.joinVoice()
    const screen = ece.page.locator('video.remote-video--screen')
    await expect(screen).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => screen.evaluate((v) => v.videoWidth)).toBeGreaterThan(0)
  })

  test('H3: kamerasını açan kişinin görüntüsü karşı tarafta görünüyor', async ({ disco }) => {
    const { mert, ece } = await mertVeEceSeste(disco)
    await ece.cameraOn()
    const video = mert.peerTile('Ece').locator('video.remote-video')
    await expect(video).toBeVisible()
    await expect
      .poll(() => video.evaluate((v) => v.videoWidth), { timeout: 15_000 })
      .toBeGreaterThan(0)
  })

  test('H4: seste iken bulunduğun kanala tekrar tıklamak sesten atmıyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await expect.poll(() => observer.voiceUsernames()).toEqual(['Mert'])

    await mert.channelButton('genel').click()
    await mert.page.waitForTimeout(2000)
    await expect(mert.leaveVoiceButton()).toBeVisible()
    expect(observer.voiceUsernames()).toEqual(['Mert'])
  })

  test('H5: sesteyken kanal gezip uygulamayı kapatan kişi çevrimiçi görünmüyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await mert.openChannel('oyun')
    await expect(mert.voicePanel()).toContainText('#genel')

    await mert.context.close()
    await expect
      .poll(async () => names(await observer.refreshMembers()), { timeout: 10_000 })
      .not.toContain('Mert')
  })

  test('H5: sesteyken başka kanala bakan kişi sesin olduğu kanalda görünüyor, baktığı kanaldan çıkınca oradan düşüyor', async ({ disco }) => {
    const genel = await disco.observer('genel')
    const oyun = await disco.observer('oyun')
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()

    await mert.openChannel('oyun')
    await expect.poll(async () => names(await oyun.refreshMembers())).toContain('Mert')
    await expect.poll(async () => voiceNames(await genel.refreshMembers())).toEqual(['Mert'])

    await mert.channelButton('genel').click()
    await expect(mert.channelTitle()).toHaveText('genel')
    await expect.poll(async () => names(await oyun.refreshMembers())).not.toContain('Mert')
    await expect.poll(async () => voiceNames(await genel.refreshMembers())).toEqual(['Mert'])
  })

  test('H5: iki cihazdan bağlanan kişi listede bir kez görünüyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    for (let i = 0; i < 2; i++) {
      const device = await disco.client('Mert')
      await device.joinChannel(disco.serverId, disco.channels.genel)
    }
    await expect.poll(async () => names(await observer.refreshMembers())).toEqual(['Gozcu', 'Mert'])
  })

  test('H9: kendi mesajın için bildirim sesi çalmıyor, başkasınınki çalıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    for (const text of ['bir', 'iki', 'üç']) await mert.send(text)
    await expect(mert.chat).toContainText('üç')
    await expect(ece.chat).toContainText('üç')

    const ticks = (user) => user.probe(() => window.__disco.tones.filter((f) => f === 700).length)
    expect(await ticks(mert)).toBe(0)
    await expect.poll(() => ticks(ece)).toBe(3)
  })

  test('H9: pencere arkadayken @adın geçince bahsetme sesi çalıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    // Mert'in penceresi arka planda.
    await mert.page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true }))
    await ece.send('@Mert seste misin?')
    await expect(mert.chat).toContainText('seste misin?')
    await expect.poll(() => mert.probe(() => window.__disco.tones.filter((f) => f === 880).length)).toBe(1)
  })

  test('H10: efekt sesleri yeni ses motoru biriktirmiyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await mert.joinVoice()
    await mert.leaveVoiceButton().click()
    for (let i = 1; i <= 5; i++) await mert.send(`mesaj ${i}`)
    await expect(ece.chat).toContainText('mesaj 5')

    // Sesler hâlâ çalıyor (katılma + ayrılma + 5 mesaj tıkı)...
    await expect.poll(() => ece.probe(() => window.__disco.tones.length)).toBeGreaterThanOrEqual(9)
    // ...ama hepsi aynı motordan: sesli sohbetin motoru + efektlerin motoru.
    const openContexts = await ece.probe(
      () => window.__disco.audioContexts.filter((c) => c.state !== 'closed').length
    )
    expect(openContexts).toBeLessThanOrEqual(2)
  })

  test('H12: sayfa dili Türkçe, büyük harfler doğru ("GİRİŞ CİHAZI", "KULLANICI")', async ({ disco }) => {
    const mert = await disco.user('Mert')
    expect(await mert.page.getAttribute('html', 'lang')).toBe('tr')
    await mert.page.getByRole('button', { name: /Ayarlar/ }).click()
    // Başlıklar CSS ile büyük harfe çevriliyor; innerText dönüşmüş hâli verir.
    const titles = () => mert.page.locator('.settings-nav-title, .field-label').allInnerTexts()
    expect(await titles()).toEqual(expect.arrayContaining(['KULLANICI AYARLARI', 'UYGULAMA AYARLARI']))
    await mert.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
    expect(await titles()).toEqual(expect.arrayContaining(['GİRİŞ CİHAZI', 'ÇIKIŞ CİHAZI']))
  })

  test('H13: telefonda hiçbir şey "Gönder" düğmesini kapatmıyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { viewport: { width: 390, height: 844 } })
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await mert.channelButton('genel').click()
    await expect(mert.channelTitle()).toHaveText('genel')

    // Web sürümünde yakınlaştırma kutusu yok (tarayıcının kendi yakınlaştırması var).
    await expect(mert.page.locator('.zoom-control')).toHaveCount(0)
    // Gönder düğmesinin ortasına tıklanınca gerçekten Gönder'e tıklanıyor.
    const send = mert.page.getByRole('button', { name: 'Gönder' })
    const box = await send.boundingBox()
    const hit = await mert.page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    )
    expect(hit).toBe('Gönder')
  })

  test("H13: masaüstü uygulamasında yakınlaştırma Ayarlar'da, Ctrl + ile de çalışıyor", async ({ disco }) => {
    const mert = await disco.user('Mert', { desktopApp: true })
    await mert.openChannel('genel')
    await expect(mert.page.locator('.zoom-control')).toHaveCount(0)

    await mert.page.keyboard.press('Control+Equal')
    await expect.poll(() => mert.probe(() => window.__disco.zoomFactors.at(-1))).toBe(1.1)

    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Görünüm' }).click()
    const zoom = mert.page.locator('.settings-screen .zoom-control')
    await expect(zoom).toContainText('110%')
    await zoom.getByTitle('Küçült (Ctrl -)').click()
    await expect(zoom).toContainText('100%')
  })


  test('H14: kanala geri dönüş reddedilince mikrofon, kamera ve ses bağlantıları kapanıyor', async ({ disco }) => {
    const { mert } = await mertVeEceSeste(disco, { mic: true })
    await mert.cameraOn()

    // Mert'in interneti gidiyor, bu arada sunucudan çıkarılıyor; internet
    // gelince kanala geri dönmeye çalışıyor ve reddediliyor.
    disco.goOffline()
    await expect(mert.page.locator('.reconnecting-banner')).toBeVisible()
    const alganis = await disco.client('Alganis')
    const kicked = await alganis.emitAck('remove-server-member', {
      token: alganis.token,
      serverId: disco.serverId,
      targetUsername: 'Mert',
    })
    expect(kicked.success).toBe(true)
    disco.goOnline()
    await expect(mert.page.getByText('Bu sunucuya erişimin yok.')).toBeVisible({ timeout: 15_000 })

    await expect
      .poll(() => mert.probe(() => window.__disco.mediaTracks.filter((t) => t.readyState === 'live').length))
      .toBe(0)
    await expect
      .poll(() => mert.probe(() => window.__disco.pcs.filter((pc) => pc.connectionState !== 'closed').length))
      .toBe(0)
    await expect(mert.page.locator('.channel-voice-indicator')).toHaveCount(0)
  })

})
