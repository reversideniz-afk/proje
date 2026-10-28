// Faz 3 (mimari sadeleştirme) testleri: uygulama başına tek, kimliği
// el sıkışmada doğrulanmış bağlantı; sunucu odaları; kişi başına
// çevrimiçi bilgisi.
import { test, expect } from '../harness/fixtures.js'

test.describe('Faz 3: mimari', { tag: '@faz3' }, () => {
  test('el sıkışmada doğrulanan bağlantı olaylarda anahtar göndermeden çalışıyor', async ({ disco }) => {
    const login = await disco.client('Mert')
    const mert = await disco.client(null, { auth: { token: login.token } })
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)

    // Anahtarsız istekler: bağlantı zaten Mert'e ait.
    const channels = await mert.emitAck('server-channels', { serverId: disco.serverId })
    expect(channels.success).toBe(true)
    const joined = await mert.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.genel })
    expect(joined.success).toBe(true)
    mert.socket.emit('send-message', { text: 'anahtarsız merhaba' })
    await expect
      .poll(() => ece.received('new-message').map((m) => `${m.username}: ${m.text}`))
      .toContain('Mert: anahtarsız merhaba')
  })

  test('geçersiz anahtarla bağlanan kişi hiçbir şey yapamıyor', async ({ disco }) => {
    const intruder = await disco.client(null, { auth: { token: 'uydurma-anahtar' } })
    const channels = await intruder.emitAck('server-channels', { serverId: disco.serverId })
    expect(channels.success).toBe(false)
  })

  test('çıkış yapınca bağlantı açık kalsa da artık kimseye ait değil', async ({ disco }) => {
    const login = await disco.client('Mert')
    const mert = await disco.client(null, { auth: { token: login.token } })
    expect((await mert.emitAck('server-channels', { serverId: disco.serverId })).success).toBe(true)
    await mert.emitAck('logout', { token: login.token })
    expect((await mert.emitAck('server-channels', { serverId: disco.serverId })).success).toBe(false)
  })

  test('uygulama baştan sona tek bağlantı kullanıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.send('merhaba')
    await mert.openChannel('oyun')
    await mert.openChannel('genel')
    await ece.joinVoice()
    await mert.joinVoice()
    await expect(ece.peerTile('Mert')).toBeVisible()
    await mert.leaveVoiceButton().click()
    await mert.page.getByRole('button', { name: /Ayarlar/ }).click()

    const sockets = await mert.probe(() => window.__disco.webSockets.filter((url) => url.includes('/socket.io/')))
    expect(sockets).toHaveLength(1)
  })

  test('üye listesi sunucu genelinde: kanala girmeyen de çevrimiçi, kapatan çevrimdışı görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const online = (name) => mert.page.locator('.member-item--online', { hasText: name })
    const offline = (name) => mert.page.locator('.member-item--offline', { hasText: name })
    await expect(offline('Ece')).toBeVisible()

    // Ece uygulamayı açıp giriş yapıyor ama hiçbir kanala girmiyor.
    const ece = await disco.user('Ece')
    await expect(online('Ece')).toBeVisible()

    // Ece başka bir kanalın sesine giriyor: Mert genel'e bakarken de görüyor.
    await ece.openChannel('oyun')
    await ece.joinVoice()
    await expect(online('Ece').getByTitle('Seste: #oyun')).toBeVisible()

    // Ece uygulamayı kapatıyor.
    await ece.context.close()
    await expect(offline('Ece')).toBeVisible()
    await expect(online('Ece')).toHaveCount(0)
  })

  test('iki kişi aynı anda ekran paylaşıyor, biri durdurunca diğerininki sürüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await ece.joinVoice()
    await mert.mediaButton('Ekranı paylaş').click()
    await ece.mediaButton('Ekranı paylaş').click()

    const screenOf = (viewer, name) =>
      viewer.page
        .locator('.remote-video-wrapper', {
          has: viewer.page.locator('.remote-video-label', { hasText: `${name} · ekran` }),
        })
        .locator('video')
    await expect.poll(() => screenOf(ece, 'Mert').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)
    await expect.poll(() => screenOf(mert, 'Ece').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)

    await ece.mediaButton('Ekran paylaşımını durdur').click()
    await expect(screenOf(mert, 'Ece')).toHaveCount(0)
    // Mert'in paylaşımı Ece'de akmaya devam ediyor (yeni kareler geliyor).
    const frames = () => screenOf(ece, 'Mert').evaluate((v) => v.getVideoPlaybackQuality().totalVideoFrames)
    const before = await frames()
    await expect.poll(frames).toBeGreaterThan(before)
  })

  test('her eşle tek WebRTC bağlantısı: kamera ve ekran aynı bağlantıdan', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await ece.joinVoice()
    await mert.micOn()
    await mert.cameraOn()
    await mert.mediaButton('Ekranı paylaş').click()
    await expect.poll(() => ece.page.locator('video.remote-video--screen').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)
    const openConnections = (user) =>
      user.probe(() => window.__disco.pcs.filter((pc) => pc.connectionState !== 'closed').length)
    expect(await openConnections(mert)).toBe(1)
    expect(await openConnections(ece)).toBe(1)
  })

  test('H16: arkadaşın açtığı yeni kanal kenar çubuğunda hemen görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const alganis = await disco.client('Alganis')
    await alganis.emitAck('create-channel', { token: alganis.token, serverId: disco.serverId, name: 'yeni-kanal' })
    await expect(mert.channelButton('yeni-kanal')).toBeVisible()
  })

  test('H16: yeni kanal ve yeni üye sunucudaki herkese anında bildiriliyor', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const mertLogin = await disco.client('Mert')
    // Mert hiçbir kanala girmeden, sadece uygulama açık.
    const mert = await disco.client(null, { auth: { token: mertLogin.token } })
    await expect.poll(() => mert.socket.connected).toBe(true)

    const channelsChanged = mert.nextEvent('channels-changed')
    const created = await alganis.emitAck('create-channel', {
      token: alganis.token,
      serverId: disco.serverId,
      name: 'yeni',
    })
    expect(created.success).toBe(true)
    expect(await channelsChanged).toEqual({ serverId: disco.serverId })

    // Yeni biri davetle katılınca üye listesi değişti bildirimi.
    const yeni = await disco.client()
    await yeni.emitAck('register', { username: 'Yeni', password: 'test-sifre-1', inviteCode: 'kayit-davet-test' })
    await yeni.login('Yeni')
    const membersChanged = mert.nextEvent('members-changed')
    const joined = await yeni.emitAck('join-server-by-invite', { token: yeni.token, inviteCode: 'sunucu-davet-test' })
    expect(joined.success).toBe(true)
    expect(await membersChanged).toEqual({ serverId: disco.serverId })
  })
})
