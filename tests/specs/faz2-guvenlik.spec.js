// Faz 2 (güvenlik ve yetki) hatalarının kalıcı testleri. Çoğu tarayıcı
// kullanmıyor: arayüzün asla göndermeyeceği istekleri doğrudan Socket.IO ya
// da HTTP ile göndererek kurcalanmış bir istemcinin neler yapabildiğini
// deniyor. Hepsi Faz 2'de düzeltildi.
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE } from '../harness/seed.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test.describe('Faz 2: güvenlik ve yetki', { tag: '@faz2' }, () => {
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
    bora.socket.emit('join-voice', { token: bora.token, channelId: disco.channels.genel })
    const mertAsSeenByBora = (await existing).find((u) => u.socketId === mert.socket.id)
    expect(mertAsSeenByBora).toMatchObject({ username: 'Mert', avatarUrl: null, muted: false, cameraOn: false })
    expect(mertAsSeenByBora).not.toHaveProperty('avatarData')
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

  test('H17: sunucu sahibi kendi sunucusunda başkasının mesajını arayüzden silebiliyor', async ({ disco }) => {
    // Mert kendi sunucusunu açıyor, Ece davetle katılıp yazıyor.
    const mertClient = await disco.client('Mert')
    const { server } = await mertClient.emitAck('create-server', { token: mertClient.token, name: 'Mert Sunucusu' })
    const { channel } = await mertClient.emitAck('create-channel', {
      token: mertClient.token,
      serverId: server.id,
      name: 'sohbet',
    })
    const ece = await disco.client('Ece')
    await ece.emitAck('join-server-by-invite', { token: ece.token, inviteCode: server.inviteCode })
    await ece.joinChannel(server.id, channel.id)
    ece.socket.emit('send-message', { token: ece.token, text: 'Ece burada' })
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    ece.socket.emit('send-message', { token: ece.token, text: 'Ece genelde' })

    const mert = await disco.user('Mert')
    // Test Sunucusu'nun sahibi değil: Ece'nin mesajında Sil yok.
    await mert.openChannel('genel')
    const other = mert.page.locator('.chat-message', { hasText: 'Ece genelde' })
    await other.click({ button: 'right' })
    await expect(other.getByTitle('Sil')).toHaveCount(0)

    // Kendi sunucusunda var ve çalışıyor.
    await mert.showDock()
    await mert.page.locator('.server-rail-icon[title="Mert Sunucusu"]').click()
    await mert.openChannel('sohbet')
    const message = mert.page.locator('.chat-message', { hasText: 'Ece burada' })
    await message.click({ button: 'right' })
    await message.getByTitle('Sil').click()
    await expect(message).toHaveCount(0)
  })

  test('H19: sohbetteki fotoğrafa tıklayınca uygulama içinde büyüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await mert.page.locator('input[type=file][accept="image/*"]').first().setInputFiles({
      name: 'kucuk.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
    })
    await ece.page.locator('img.chat-photo').click()
    await expect(ece.page.locator('.photo-lightbox img')).toBeVisible()
    expect(ece.context.pages()).toHaveLength(1)
    await ece.page.keyboard.press('Escape')
    await expect(ece.page.locator('.photo-lightbox')).toHaveCount(0)
  })

  test('H18: kanalda değilken çıkış yapınca oturum sunucuda da siliniyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { rememberMe: true })
    const token = await mert.page.evaluate(() => localStorage.getItem('rememberedSessionToken'))
    expect(token).toBeTruthy()
    const stillValid = async () => {
      const probe = await disco.client()
      const response = await probe.emitAck('server-channels', { token, serverId: disco.serverId })
      probe.close()
      return response.success
    }
    expect(await stillValid()).toBe(true)

    // Hiçbir kanala girmeden Ayarlar > Çıkış yap.
    await mert.page.getByRole('button', { name: /Ayarlar/ }).click()
    await mert.page.getByRole('button', { name: 'Çıkış yap' }).click()
    await expect(mert.page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible()
    await expect.poll(stillValid).toBe(false)
  })

  // Render'ın vekili gerçek adresi X-Forwarded-For'un sonuna ekliyor; baştaki
  // değer istemcinin uydurduğu. Testte ikisini de biz yazıyoruz.
  const viaRender = (spoofed, real) => ({ headers: { 'X-Forwarded-For': `${spoofed}, ${real}` } })

  test('H20: IP banı sahte X-Forwarded-For değeriyle atlatılamıyor', async ({ disco }) => {
    const tryRegister = async (headers, inviteCode, username = 'Saldirgan') => {
      const client = await disco.client(null, headers)
      const response = await client.emitAck('register', { username, password: PASSWORD, inviteCode })
      client.close()
      return response
    }
    // 9.9.9.9 her denemede başka bir sahte adres yazarak 10 yanlış kod deniyor.
    for (let i = 0; i < 10; i++) await tryRegister(viaRender(`1.1.1.${i}`, '9.9.9.9'), 'yanlis-kod')
    // Doğru kodu bulsa da, yine başka bir sahte adresle: banlı.
    const banned = await tryRegister(viaRender('2.2.2.2', '9.9.9.9'), REGISTER_INVITE_CODE)
    expect(banned).toMatchObject({ success: false, message: 'Davet kodu hatalı.' })
    // Başka bir gerçek adres (ve onun sahte değeri olarak banlı adres) etkilenmiyor.
    const friend = await tryRegister(viaRender('9.9.9.9', '5.5.5.5'), REGISTER_INVITE_CODE, 'Arkadas')
    expect(friend.success).toBe(true)
  })

  test('H20: aynı adresten çok sayıda yanlış girişten sonra o adres bekletiliyor', async ({ disco }) => {
    const tryLogin = async (headers, username, password) => {
      const client = await disco.client(null, headers)
      const response = await client.emitAck('login', { username, password })
      client.close()
      return response
    }
    // Farklı hesaplara sırayla deneme (hesap başına kilit bunu durdurmuyordu).
    for (let i = 0; i < 20; i++) {
      await tryLogin(viaRender(`3.3.3.${i}`, '8.8.8.8'), ['Mert', 'Ece', 'Bora', 'Gozcu'][i % 4], 'yanlis')
    }
    const blocked = await tryLogin(viaRender('4.4.4.4', '8.8.8.8'), 'Alganis', PASSWORD)
    expect(blocked.success).toBe(false)
    expect(blocked.message).toContain('çok fazla yanlış deneme')
    // Başka bir adresten doğru şifreyle giriş çalışıyor.
    expect((await tryLogin(viaRender('8.8.8.8', '7.7.7.7'), 'Alganis', PASSWORD)).success).toBe(true)
  })

  test('H11: ayrılmış adlar ve büyük/küçük harf kopyası adlar alınamıyor', async ({ disco }) => {
    // Uygulama gibi her denemede yeni bağlantı (bağlantı başına giriş/kayıt
    // hız sınırı var, bkz. H8).
    const register = async (username) => {
      const client = await disco.client()
      const response = await client.emitAck('register', {
        username,
        password: PASSWORD,
        inviteCode: REGISTER_INVITE_CODE,
      })
      client.close()
      return response
    }
    for (const username of ['Sistem', 'SİSTEM', 'ADMIN', 'all', 'alganis', 'ALGANIS', 'mErT']) {
      const response = await register(username)
      expect.soft(response.message, `"${username}" adıyla kayıt kabul edilmemeli`).toMatch(
        /kullanılamaz|zaten alınmış/
      )
    }
    expect((await register('Sistem')).message).toBe('Bu kullanıcı adı kullanılamaz.')
    expect((await register('alganis')).message).toBe('Bu kullanıcı adı zaten alınmış.')
    // Türkçe harfli yeni bir ad ise sorunsuz alınabiliyor.
    expect((await register('Işıl')).success).toBe(true)
  })

  test('H11: giriş büyük/küçük harfe duyarsız, hesap adı değişmiyor', async ({ disco }) => {
    const client = await disco.client()
    const response = await client.emitAck('login', { username: 'mert', password: PASSWORD })
    expect(response.success).toBe(true)
    expect(response.username).toBe('Mert')
  })

  test('H11: sunucunun kendi mesajları kullanıcı mesajlarından ayrı görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.send('!sil 3')
    const systemMessage = mert.page.locator('.chat-message--system', { hasText: 'Silinecek mesajın yok.' })
    await expect(systemMessage).toBeVisible()
  })
})
