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
