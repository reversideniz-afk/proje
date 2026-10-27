// Faz 1'de (ses ve oturum güvenilirliği) düzeltilecek, canlı doğrulanmış
// hatalar. Her test DOĞRU davranışı tarif ediyor ve bugün başarısız
// olduğu için test.fail ile "beklenen başarısızlık" olarak işaretli.
//
// Bir hatayı düzelttiğinde testi bu dosyada "beklenmedik şekilde geçti"
// diye kırmızı görürsün: o zaman test.fail'i test'e çevir, test artık
// kalıcı bir koruma olur. Hata kodları (H1, H2…) Disco Gelişim Raporu'ndan.
import { test, expect } from '../harness/fixtures.js'

const names = (members) => (members?.online || []).map((m) => m.username).sort()
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

test.describe('Bilinen hatalar: Faz 1', { tag: '@faz1' }, () => {
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

    const replaced = eski.nextEvent('voice-replaced')
    const response = await yeni.emitAck('join-voice', { token: yeni.token, channelId: disco.channels.genel })
    expect(response.success).toBe(true)
    await replaced

    const existing = ece.nextEvent('existing-voice-users')
    await ece.emitAck('join-voice', { token: ece.token, channelId: disco.channels.genel })
    expect((await existing).map((u) => u.socketId)).toEqual([yeni.socket.id])
  })

  test('H1: sesteyken başka kanala bakarken kopan kişi sesin olduğu kanala döner', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const { mert } = await mertVeEceSeste(disco)
    await mert.openChannel('oyun')
    await expect(mert.page.locator('.voice-elsewhere-banner')).toBeVisible()

    const mark = observer.mark()
    disco.dropConnections()
    await expect
      .poll(() => observer.membersSince(mark).some((m) => !voiceNames(m).includes('Mert')))
      .toBe(true)
    await expect
      .poll(() => voiceNames(observer.latestMembersSince(mark)), { timeout: 20_000 })
      .toEqual(['Ece', 'Mert'])
    // Ekranda hâlâ #oyun açık.
    await expect(mert.page.locator('.channel-header h2')).toHaveText('# oyun')
  })

  test.fail('H2: sunucu yeniden başlayınca oturum ve kanal korunuyor', async ({ disco }) => {
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

  test('H31: ekran paylaşımı sürerken sese giren kişi paylaşımı görüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await mert.mediaButton('Ekranı paylaş').click()
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

  test.fail('H4: seste iken bulunduğun kanala tekrar tıklamak sesten atmıyor', async ({ disco }) => {
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

  test.fail('H5: sesteyken kanal gezip uygulamayı kapatan kişi çevrimiçi görünmüyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await mert.openChannel('oyun')
    await expect(mert.page.locator('.voice-elsewhere-banner')).toBeVisible()

    await mert.context.close()
    await expect
      .poll(async () => names(await observer.refreshMembers()), { timeout: 10_000 })
      .not.toContain('Mert')
  })

  test.fail('H9: kendi mesajın için bildirim sesi çalmıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    for (const text of ['bir', 'iki', 'üç']) await mert.send(text)
    await expect(mert.chat).toContainText('üç')

    const messageTicks = await mert.probe(() => window.__disco.tones.filter((f) => f === 700).length)
    expect(messageTicks).toBe(0)
  })

  test.fail('H10: efekt sesleri yeni ses motoru biriktirmiyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    for (let i = 1; i <= 5; i++) await mert.send(`mesaj ${i}`)
    await expect(ece.chat).toContainText('mesaj 5')

    const openContexts = await ece.probe(
      () => window.__disco.audioContexts.filter((c) => c.state !== 'closed').length
    )
    expect(openContexts).toBeLessThanOrEqual(2)
  })

  test.fail('H12: sayfa dili Türkçe, büyük harfler doğru ("PROFİL")', async ({ disco }) => {
    const mert = await disco.user('Mert', { login: false })
    expect(await mert.page.getAttribute('html', 'lang')).toBe('tr')
  })

  test.fail('H13: telefonda yakınlaştırma kutusu "Gönder" düğmesini kapatmıyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { viewport: { width: 390, height: 844 } })
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await mert.channelButton('genel').click()
    await expect(mert.page.locator('.channel-header h2')).toHaveText('# genel')

    const send = await mert.page.getByRole('button', { name: 'Gönder' }).boundingBox()
    const zoom = await mert.page.locator('.zoom-control').boundingBox()
    const overlaps =
      !!zoom &&
      zoom.x < send.x + send.width &&
      send.x < zoom.x + zoom.width &&
      zoom.y < send.y + send.height &&
      send.y < zoom.y + zoom.height
    expect(overlaps).toBe(false)
  })

  test.fail('H14: kanala geri dönüş reddedilince mikrofon ve ses durumu temizleniyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await mert.micOn()

    const alganis = await disco.client('Alganis')
    const kicked = await alganis.emitAck('remove-server-member', {
      token: alganis.token,
      serverId: disco.serverId,
      targetUsername: 'Mert',
    })
    expect(kicked.success).toBe(true)
    disco.dropConnections()
    await expect(mert.page.getByText('Bu sunucuya erişimin yok.')).toBeVisible({ timeout: 15_000 })

    await expect
      .poll(() => mert.probe(() => window.__disco.mediaTracks.filter((t) => t.readyState === 'live').length))
      .toBe(0)
    await expect(mert.page.locator('.channel-voice-indicator')).toHaveCount(0)
  })
})
