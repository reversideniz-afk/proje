// Faz 2'de (güvenlik ve yetki) düzeltilecek hatalar. Bunlar tarayıcı
// kullanmıyor: arayüzün asla göndermeyeceği istekleri doğrudan Socket.IO
// ile göndererek, kurcalanmış bir istemcinin neler yapabildiğini deniyor.
// Düzelince test.fail'i test'e çevir (bkz. README, Testler).
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE } from '../harness/seed.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test.describe('Bilinen hatalar: Faz 2', { tag: '@faz2' }, () => {
  test('H6: seste başkasının adına ve dış avatar adresine bürünülemiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    const bora = await disco.client('Bora')
    for (const client of [mert, ece, bora]) await client.joinChannel(disco.serverId, disco.channels.genel)
    for (const client of [mert, ece]) {
      await client.emitAck('join-voice', { token: client.token, channelId: disco.channels.genel })
    }

    // Geçerli alan (muted) iletiliyor, kalanlar sessizce atılıyor.
    const forwarded = ece.nextEvent('user-state-update')
    mert.socket.emit('state-update', {
      muted: false,
      cameraOn: 'evet',
      username: 'Alganis',
      avatarData: 'https://ornek.invalid/iz.png',
    })
    expect((await forwarded).state).toEqual({ muted: false })

    const existing = bora.nextEvent('existing-voice-users')
    bora.socket.emit('join-voice', { token: bora.token })
    const mertAsSeenByBora = (await existing).find((u) => u.socketId === mert.socket.id)
    expect(mertAsSeenByBora).toMatchObject({ username: 'Mert', avatarData: null, muted: false, cameraOn: false })
  })

  test('H7: sunucudan atılan kişi kanaldan çıkarılıyor, artık mesaj gönderemiyor', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    const bora = await disco.client('Bora')
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    await bora.joinChannel(disco.serverId, disco.channels.genel)

    const removed = bora.nextEvent('join-error')
    const kicked = await alganis.emitAck('remove-server-member', {
      token: alganis.token,
      serverId: disco.serverId,
      targetUsername: 'Bora',
    })
    expect(kicked.success).toBe(true)
    expect(await removed).toBe('Bu sunucudan çıkarıldın.')

    bora.socket.emit('send-message', { token: bora.token, text: 'Atıldım ama hâlâ yazabiliyorum' })
    await sleep(1500)
    expect(mert.received('new-message').map((m) => m.text)).not.toContain('Atıldım ama hâlâ yazabiliyorum')
    await expect(bora.joinChannel(disco.serverId, disco.channels.genel)).rejects.toThrow(
      'Bu sunucuya erişimin yok.'
    )
  })

  test('H7: rolü alınan kişi kısıtlı kanaldan ve sesinden çıkarılıyor', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const ece = await disco.client('Ece')
    const bora = await disco.client('Bora')
    for (const client of [ece, bora]) await client.joinChannel(disco.serverId, disco.channels.ozel)
    await ece.emitAck('join-voice', { token: ece.token, channelId: disco.channels.ozel })

    const voiceEnded = ece.nextEvent('voice-ended')
    const joinError = ece.nextEvent('join-error')
    alganis.socket.emit('update-user-role', {
      token: alganis.token,
      targetUsername: 'Ece',
      role: 'VIP',
      action: 'remove',
    })
    expect((await voiceEnded).message).toBe('Bu kanala erişim yetkin kalmadı.')
    expect(await joinError).toBe('Bu kanala erişim yetkin kalmadı.')

    ece.socket.emit('send-message', { token: ece.token, text: 'Rolüm gitti ama yazıyorum' })
    await sleep(1500)
    expect(bora.received('new-message').map((m) => m.text)).not.toContain('Rolüm gitti ama yazıyorum')
  })

  test('H7: sesteyken sunucudan atılan kişinin arayüzü ve sesi temizleniyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.joinVoice()
    await ece.joinVoice()
    await mert.micOn()
    await expect(ece.peerTile('Mert')).toBeVisible()

    const alganis = await disco.client('Alganis')
    await alganis.emitAck('remove-server-member', {
      token: alganis.token,
      serverId: disco.serverId,
      targetUsername: 'Mert',
    })
    await expect(mert.page.getByText('Bu sunucudan çıkarıldın.')).toBeVisible()
    await expect(mert.page.locator('.server-rail-icon', { hasText: 'T' })).toHaveCount(0)
    await expect
      .poll(() => mert.probe(() => window.__disco.mediaTracks.filter((t) => t.readyState === 'live').length))
      .toBe(0)
    await expect(ece.peerTile('Mert')).toHaveCount(0)
  })

  test('H8: giriş yapmamış biri büyük paket gönderince bağlantısı kesiliyor', async ({ disco }) => {
    const anonymous = await disco.client()
    const disconnected = anonymous.nextEvent('disconnect', () => true, 10_000)
    anonymous.socket.emit('login', { username: 'x'.repeat(2 * 1024 * 1024), password: 'x' }, () => {})
    await disconnected
  })

  test('H8: art arda gönderilen mesajlar sınırlanıyor, gönderen uyarılıyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    for (const client of [mert, ece]) await client.joinChannel(disco.serverId, disco.channels.genel)
    for (let i = 1; i <= 30; i++) mert.socket.emit('send-message', { token: mert.token, text: `sel ${i}` })
    await expect
      .poll(() => mert.received('new-message').some((m) => m.text?.startsWith('Çok hızlı mesaj')))
      .toBe(true)
    await sleep(1000)
    const delivered = ece.received('new-message').filter((m) => m.text?.startsWith('sel '))
    expect(delivered.length).toBeGreaterThan(0)
    expect(delivered.length).toBeLessThan(15)
  })

  test('H8: büyük fotoğraf (3 MB) HTTP ile gidiyor ve karşıda görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')

    // Geçerli 1x1 PNG + sonuna 3 MB dolgu (PNG okuyucuları IEND sonrasını yok sayar).
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const buffer = Buffer.concat([tinyPng, Buffer.alloc(3 * 1024 * 1024, 7)])
    await mert.page.locator('input[type=file][accept="image/*"]').first().setInputFiles({
      name: 'buyuk.png',
      mimeType: 'image/png',
      buffer,
    })
    const photo = ece.page.locator('img.chat-photo')
    await expect(photo).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBe(1)
  })

  test('H8: fotoğraf yolu giriş yapmamışı ve kanalda olmayanı reddediyor', async ({ disco }) => {
    const body = JSON.stringify({
      channelId: disco.channels.genel,
      imageData: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
    })
    const post = (token) =>
      fetch(`${disco.socketUrl}/api/photos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      })
    expect((await post(null)).status).toBe(401)
    expect((await post('uydurma-anahtar')).status).toBe(401)
    const mert = await disco.client('Mert')
    expect((await post(mert.token)).status).toBe(403)
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    expect((await post(mert.token)).status).toBe(200)
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
