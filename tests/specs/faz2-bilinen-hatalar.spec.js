// Faz 2'de (güvenlik ve yetki) düzeltilecek hatalar. Bunlar tarayıcı
// kullanmıyor: arayüzün asla göndermeyeceği istekleri doğrudan Socket.IO
// ile göndererek, kurcalanmış bir istemcinin neler yapabildiğini deniyor.
// Düzelince test.fail'i test'e çevir (bkz. README, Testler).
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE } from '../harness/seed.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test.describe('Bilinen hatalar: Faz 2', { tag: '@faz2' }, () => {
  test.fail('H6: seste başkasının adına ve dış avatar adresine bürünülemiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    const bora = await disco.client('Bora')
    for (const client of [mert, ece, bora]) await client.joinChannel(disco.serverId, disco.channels.genel)
    for (const client of [mert, ece]) {
      const joined = client.nextEvent('existing-voice-users')
      client.socket.emit('join-voice', { token: client.token })
      await joined
    }

    const forwarded = ece.nextEvent('user-state-update')
    mert.socket.emit('state-update', { username: 'Alganis', avatarData: 'https://ornek.invalid/iz.png' })
    await forwarded

    const existing = bora.nextEvent('existing-voice-users')
    bora.socket.emit('join-voice', { token: bora.token })
    const mertAsSeenByBora = (await existing).find((u) => u.socketId === mert.socket.id)
    expect(mertAsSeenByBora.username).toBe('Mert')
    expect(mertAsSeenByBora.avatarData).toBeNull()
  })

  test.fail('H7: sunucudan atılan kişi artık mesaj gönderemiyor', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    const bora = await disco.client('Bora')
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    await bora.joinChannel(disco.serverId, disco.channels.genel)

    const kicked = await alganis.emitAck('remove-server-member', {
      token: alganis.token,
      serverId: disco.serverId,
      targetUsername: 'Bora',
    })
    expect(kicked.success).toBe(true)

    bora.socket.emit('send-message', { token: bora.token, text: 'Atıldım ama hâlâ yazabiliyorum' })
    await sleep(1500)
    expect(mert.received('new-message').map((m) => m.text)).not.toContain('Atıldım ama hâlâ yazabiliyorum')
  })

  test.fail('H8: giriş yapmamış biri büyük paket gönderince bağlantısı kesiliyor', async ({ disco }) => {
    const anonymous = await disco.client()
    const disconnected = anonymous.nextEvent('disconnect', () => true, 10_000)
    anonymous.socket.emit('login', { username: 'x'.repeat(2 * 1024 * 1024), password: 'x' }, () => {})
    await disconnected
  })

  test.fail('H11: ayrılmış adlar ve büyük/küçük harf kopyası adlar alınamıyor', async ({ disco }) => {
    const anonymous = await disco.client()
    for (const username of ['Sistem', 'alganis']) {
      const response = await anonymous.emitAck('register', {
        username,
        password: PASSWORD,
        inviteCode: REGISTER_INVITE_CODE,
      })
      expect.soft(response.success, `"${username}" adıyla kayıt kabul edilmemeli`).toBe(false)
    }
  })
})
