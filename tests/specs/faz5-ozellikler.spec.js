// Faz 5: Discord'a yaklaşan özellikler ve bu fazda kapanan hatalar (H28, H33).
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE, SERVER_INVITE_CODE, expireInvite } from '../harness/seed.js'

// Hiçbir sunucuya üye olmayan yeni bir kullanıcı (kayıt + giriş).
async function newUser(disco, username) {
  const client = await disco.client()
  const registered = await client.emitAck('register', { username, password: PASSWORD, inviteCode: REGISTER_INVITE_CODE })
  expect(registered.success).toBe(true)
  await client.login(username)
  return client
}

const micTracks = (user) =>
  user.probe(() =>
    window.__disco.mediaTracks
      .filter((t) => t.kind === 'audio')
      .map((t) => ({ enabled: t.enabled, live: t.readyState === 'live' }))
  )

// Giriş hassasiyeti testlerindeki tonlar (bkz. useSyntheticMic): konuşma
// (tepe -14 dB, etkin değer -17) ve sürekli ortam sesi (tepe -40, etkin -43).
const SPEECH_DB = -14
const ROOM_DB = -40

// Hoparlörde art arda iki ölçümün ikisinde de en az bu kadar ses var.
async function expectHears(user, minPeak) {
  await expect
    .poll(async () => Math.min(await user.speakerPeak(), await user.speakerPeak()), {
      message: `${user.name} beklenen sesi duymuyor`,
      timeout: 15_000,
    })
    .toBeGreaterThan(minPeak)
}

// ...ya da iki ölçümde de (neredeyse) hiç ses yok.
async function expectSilence(user) {
  await expect
    .poll(async () => Math.max(await user.speakerPeak(), await user.speakerPeak()), {
      message: `${user.name} hâlâ ses duyuyor`,
      timeout: 15_000,
    })
    .toBeLessThan(0.002)
}

async function openAudioSettings(user) {
  await user.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await user.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
}

async function joinVoiceTogether(...users) {
  for (const user of users) {
    await user.openChannel('genel')
    await user.joinVoice()
  }
}

async function sendAs(client, text) {
  const delivered = client.nextEvent('new-message', (m) => m.text === text)
  client.socket.emit('send-message', { token: client.token, text })
  return delivered
}

test.describe('Faz 5: özellikler', { tag: '@faz5' }, () => {
  test('okunmamışlar ve bahsedilmeler uygulama kapalıyken de birikiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    await mert.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.genel })
    await mert.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.oyun })
    mert.close()

    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    const first = await sendAs(ece, 'akşam kim var')
    await sendAs(ece, '@Mert sen de gel')
    await sendAs(ece, '@mertcan değil, sadece selam')

    const again = await disco.client('Mert')
    const channels = (await again.emitAck('server-channels', { serverId: disco.serverId })).channels
    const byName = Object.fromEntries(channels.map((c) => [c.name, c]))
    expect(byName.genel).toMatchObject({ unread: true, mentions: 1 })
    expect(byName.oyun).toMatchObject({ unread: false, mentions: 0 })
    const servers = (await again.emitAck('list-my-servers', {})).servers
    expect(servers.find((s) => s.id === disco.serverId)).toMatchObject({ unread: true, mentions: 1 })

    // Kanala girince son okuma anı geliyor ("Yeni" çizgisi için), okununca sıfırlanıyor.
    const joined = await again.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.genel })
    expect(new Date(joined.lastReadAt).getTime()).toBeLessThan(new Date(first.createdAt).getTime())
    again.socket.emit('mark-read', { channelId: disco.channels.genel })
    await expect
      .poll(async () => {
        const list = (await again.emitAck('server-channels', { serverId: disco.serverId })).channels
        return list.find((c) => c.name === 'genel')
      })
      .toMatchObject({ unread: false, mentions: 0 })
  })

  test('başka kanalda bahsedilince sayı ve bildirim çıkıyor, bildirime tıklayınca kanal "Yeni" çizgisiyle açılıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    // Masaüstü bildirimleri kayda geçsin (gerçek bildirim gösterilmesin).
    await mert.page.evaluate(() => {
      window.__notes = []
      window.Notification = class {
        static permission = 'granted'
        static requestPermission = async () => 'granted'
        constructor(title, options) {
          window.__notes.push({ title, body: options.body })
          window.__lastNote = this
        }
        close() {}
      }
    })
    await mert.openChannel('genel')
    await mert.page.waitForTimeout(1500) // okundu bilgisi gitsin
    await mert.openChannel('oyun')

    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    await sendAs(ece, 'akşam planı ne')
    await sendAs(ece, '@Mert genele bak')

    const genel = mert.channelButton('genel')
    await expect(genel.locator('.mention-badge')).toHaveText('1')
    await expect(genel).toHaveClass(/channel-button--unread/)
    await expect.poll(() => mert.probe(() => window.__notes)).toEqual([{ title: 'Ece · #genel', body: '@Mert genele bak' }])

    await mert.page.evaluate(() => window.__lastNote.onclick())
    await expect(mert.channelTitle()).toHaveText('genel')
    await expect(genel.locator('.mention-badge')).toHaveCount(0)
    const divider = mert.chat.getByRole('separator', { name: 'Yeni mesajlar' })
    await expect(divider).toBeVisible()
    // Çizgi Ece'nin ilk yeni mesajının hemen üstünde.
    const next = await divider.evaluate((el) => el.nextElementSibling?.textContent)
    expect(next).toContain('akşam planı ne')

    // Bildirimler kapatılınca bahsedilmede bildirim gelmiyor (sayı yine çıkıyor).
    await mert.openChannel('oyun')
    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Bildirimler' }).click()
    await mert.page.getByRole('switch', { name: 'Masaüstü bildirimi göster' }).uncheck()
    await mert.page.keyboard.press('Escape')
    await sendAs(ece, '@Mert tekrar')
    await expect(genel.locator('.mention-badge')).toHaveText('1')
    expect(await mert.probe(() => window.__notes.length)).toBe(1)
  })

  test('uygulama kapalıyken gelen mesajlar açılınca kanal listesinde okunmamış görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.openChannel('oyun')
    await mert.page.waitForTimeout(1500)
    await mert.context.close()

    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    await sendAs(ece, 'sen yokken yazdım')

    const again = await disco.user('Mert')
    await expect(again.channelButton('genel')).toHaveClass(/channel-button--unread/)
    await expect(again.channelButton('oyun')).not.toHaveClass(/channel-button--unread/)
  })

  test('başka sunucuda bahsedilince sunucu şeridinde sayı çıkıyor', async ({ disco }) => {
    const owner = await disco.client('Mert')
    const { server } = await owner.emitAck('create-server', { token: owner.token, name: 'Mert Sunucusu' })
    const { channel } = await owner.emitAck('create-channel', { token: owner.token, serverId: server.id, name: 'sohbet' })
    const ece = await disco.client('Ece')
    await ece.emitAck('join-server-by-invite', { token: ece.token, inviteCode: server.inviteCode })
    await ece.joinChannel(server.id, channel.id)

    const mert = await disco.user('Mert')
    await mert.page.locator('.server-rail-icon[title="Test Sunucusu"]').click()
    await mert.openChannel('genel')
    await sendAs(ece, '@Mert buraya gel')
    const icon = mert.page.locator('.server-rail-icon[title="Mert Sunucusu"]')
    await expect(icon.locator('.mention-badge')).toHaveText('1')
    await expect(icon).toHaveAttribute('aria-label', 'Mert Sunucusu, 1 bahsedilme')
  })

  test('yanıt: asıl mesajın kopyası saklanıyor, sadece aynı kanaldan, yanıt alan bahsedilmiş sayılıyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    await mert.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.genel })
    const original = await sendAs(mert, ('akşam 9 gibi giriyorum ' + 'uzun '.repeat(40)).trim())
    await mert.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.oyun })
    const elsewhere = await sendAs(mert, 'oyun kanalındaki mesaj')
    mert.close()

    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    const reply = ece.nextEvent('new-message', (m) => m.text === 'tamam geliyorum')
    ece.socket.emit('send-message', { token: ece.token, text: 'tamam geliyorum', replyToId: original.id })
    expect((await reply).replyTo).toEqual({ id: original.id, username: 'Mert', text: original.text.slice(0, 120) })

    // Başka kanaldaki mesaja buradan yanıt verilemiyor; geçersiz kimlik yok sayılıyor.
    const foreign = ece.nextEvent('new-message', (m) => m.text === 'çapraz')
    ece.socket.emit('send-message', { token: ece.token, text: 'çapraz', replyToId: elsewhere.id })
    expect((await foreign).replyTo).toBeNull()
    const junk = ece.nextEvent('new-message', (m) => m.text === 'bozuk')
    ece.socket.emit('send-message', { token: ece.token, text: 'bozuk', replyToId: { $ne: null } })
    expect((await junk).replyTo).toBeNull()

    // Mert'e yanıt, uygulaması kapalıyken bahsedilme olarak sayılıyor ve geçmişte de görünüyor.
    const again = await disco.client('Mert')
    const channels = (await again.emitAck('server-channels', { serverId: disco.serverId })).channels
    expect(channels.find((c) => c.name === 'genel')).toMatchObject({ unread: true, mentions: 1 })
    const history = again.nextEvent('message-history')
    await again.emitAck('join-channel', { serverId: disco.serverId, channelId: disco.channels.genel })
    expect((await history).find((m) => m.text === 'tamam geliyorum').replyTo.username).toBe('Mert')
  })

  test('yanıt arayüzü: araç çubuğundan yanıtla, karşıda önizleme ve vurgu, Esc vazgeçiyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    await ece.send('kim geliyor bu akşam')
    const asked = mert.chat.locator('.chat-message', { hasText: 'kim geliyor bu akşam' })
    await asked.hover()
    await asked.getByRole('button', { name: 'Yanıtla' }).click()
    await expect(mert.page.locator('.composer-reply')).toContainText('Yanıt veriyorsun: Ece')
    await expect(mert.page.getByLabel('Mesaj yaz')).toBeFocused()
    await mert.page.keyboard.press('Escape')
    await expect(mert.page.locator('.composer-reply')).toHaveCount(0)

    await asked.hover()
    await asked.getByRole('button', { name: 'Yanıtla' }).click()
    await mert.page.keyboard.type('ben geliyorum')
    await mert.page.keyboard.press('Enter')
    await expect(mert.page.locator('.composer-reply')).toHaveCount(0)

    const answer = ece.chat.locator('.chat-message', { hasText: 'ben geliyorum' })
    await expect(answer.locator('.chat-message-reply-preview')).toContainText('Ece')
    await expect(answer.locator('.chat-message-reply-preview')).toContainText('kim geliyor bu akşam')
    await expect(answer).toHaveClass(/chat-message--mention/)
    await answer.locator('.chat-message-reply-preview').click()
    await expect(ece.chat.locator('.chat-message', { hasText: 'kim geliyor bu akşam' }).first()).toHaveClass(/is-highlighted/)
  })

  test('biçimlendirme: kalın, italik, kod, üstü çizili, spoiler, alıntı, link; HTML düz metin kalıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    const input = mert.page.getByLabel('Mesaj yaz')
    await input.fill(
      '**kalın** *italik* _de_ `kod` ~~çizik~~ ||sürpriz|| https://ornek.invalid/sayfa?a=1. @Ece snake_case_ad\n> alıntı satırı\n```\nconst x = 1 < 2\n```\n<img src=x onerror="window.__xss=1">'
    )
    await mert.page.keyboard.press('Enter')

    const message = ece.chat.locator('.chat-message', { hasText: 'kalın' })
    const text = message.locator('.chat-message-text')
    await expect(text.locator('strong')).toHaveText('kalın')
    await expect(text.locator('em')).toHaveText(['italik', 'de'])
    await expect(text.locator('code.md-code')).toHaveText('kod')
    await expect(text.locator('del')).toHaveText('çizik')
    await expect(text.locator('blockquote')).toHaveText('alıntı satırı')
    await expect(text.locator('pre.md-codeblock')).toHaveText('const x = 1 < 2')
    const link = text.getByRole('link', { name: 'https://ornek.invalid/sayfa?a=1' })
    await expect(link).toHaveAttribute('href', 'https://ornek.invalid/sayfa?a=1')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(text).toContainText('snake_case_ad')
    await expect(text.locator('.mention--me')).toHaveText('@Ece')

    const spoiler = text.getByRole('button', { name: 'Spoiler, göstermek için tıkla' })
    await expect(spoiler).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    await spoiler.click()
    await expect(text.locator('.md-spoiler--shown')).toHaveText('sürpriz')

    // HTML öğesi oluşmuyor, metin olarak görünüyor.
    await expect(text.locator('img')).toHaveCount(0)
    await expect(text).toContainText('<img src=x onerror="window.__xss=1">')
    expect(await ece.probe(() => window.__xss)).toBeUndefined()
  })

  test('davetler: süreli ve sınırlı, sadece sahip oluşturuyor, giriş yapmadan sunucu adı görünüyor', async ({ disco }) => {
    const owner = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    expect((await mert.emitAck('create-invite', { serverId: disco.serverId, maxUses: 1 })).success).toBe(false)
    const once = (await owner.emitAck('create-invite', { serverId: disco.serverId, maxUses: 1 })).invite
    expect(once).toMatchObject({ maxUses: 1, uses: 0, createdBy: 'Alganis' })
    expect((await owner.emitAck('create-invite', { serverId: disco.serverId, maxUses: 3 })).success).toBe(false)

    // Giriş yapmamış biri bağlantıdaki sunucunun adını görebiliyor.
    const anonymous = await disco.client()
    expect(await anonymous.emitAck('invite-info', { code: once.code })).toEqual({
      success: true,
      server: { id: disco.serverId, name: 'Test Sunucusu', memberCount: 5 },
    })
    expect((await anonymous.emitAck('invite-info', { code: 'yok-boyle-bir-kod' })).message).toBe('Geçersiz davet kodu.')
    expect((await anonymous.emitAck('join-server-by-invite', { inviteCode: once.code })).success).toBe(false)

    // Tek kullanımlık davet: ilk kişi giriyor, ikincisi giremiyor.
    const first = await newUser(disco, 'Yolcu')
    expect((await first.emitAck('join-server-by-invite', { inviteCode: once.code })).success).toBe(true)
    const second = await newUser(disco, 'Gezgin')
    expect((await second.emitAck('join-server-by-invite', { inviteCode: once.code })).message).toBe(
      'Bu davetin kullanım sınırı dolmuş.'
    )
    // Kalıcı kod hâlâ çalışıyor.
    expect((await second.emitAck('join-server-by-invite', { inviteCode: SERVER_INVITE_CODE })).success).toBe(true)

    // Süresi dolan ve iptal edilen davetler.
    const hourly = (await owner.emitAck('create-invite', { serverId: disco.serverId, expiresInHours: 1 })).invite
    expect(new Date(hourly.expiresAt) - Date.now()).toBeGreaterThan(59 * 60_000)
    const listed = (await owner.emitAck('list-invites', { serverId: disco.serverId })).invites.map((i) => i.code)
    expect(listed).toEqual([hourly.code]) // tek kullanımlık olan doldu, listede yok
    await expireInvite(disco.mongoUri, hourly.code)
    const third = await newUser(disco, 'Misafir')
    expect((await third.emitAck('join-server-by-invite', { inviteCode: hourly.code })).message).toBe(
      'Bu davetin süresi dolmuş.'
    )
    const forever = (await owner.emitAck('create-invite', { serverId: disco.serverId })).invite
    expect(forever.expiresAt).toBeNull()
    expect((await mert.emitAck('delete-invite', { serverId: disco.serverId, code: forever.code })).success).toBe(false)
    await owner.emitAck('delete-invite', { serverId: disco.serverId, code: forever.code })
    expect((await third.emitAck('join-server-by-invite', { inviteCode: forever.code })).message).toBe('Geçersiz davet kodu.')

    // /davet/KOD uygulamanın kendisine yönlendiriyor.
    const redirect = await fetch(`${disco.socketUrl}/davet/${forever.code}`, { redirect: 'manual' })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe(`/?davet=${forever.code}`)
  })

  test('davet bağlantısıyla gelen kişi giriş ekranında sunucuyu görüyor, girince katılıyor', async ({ disco }) => {
    const owner = await disco.client('Alganis')
    const { code } = (await owner.emitAck('create-invite', { serverId: disco.serverId, expiresInHours: 24 })).invite
    ;(await newUser(disco, 'Yolcu')).close()

    const yolcu = await disco.user('Yolcu', { login: false, path: `/?davet=${code}` })
    await expect(yolcu.page.getByRole('status')).toContainText('Seni Test Sunucusu sunucusuna davet ettiler')
    expect(new URL(yolcu.page.url()).search).toBe('')
    await yolcu.login()
    const dialog = yolcu.page.getByRole('dialog', { name: 'Sunucu daveti' })
    await expect(dialog).toContainText('Test Sunucusu')
    await expect(dialog).toContainText('5 üye')
    await dialog.getByRole('button', { name: 'Sunucuya katıl' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(yolcu.page.locator('.server-rail-icon--active')).toHaveAttribute('title', 'Test Sunucusu')
    await expect(yolcu.channelButton('genel')).toBeVisible()
  })

  test('H33: açık sunucunun simgesine tekrar tıklamak kanaldan ve sesten çıkarmıyor', async ({ disco }) => {
    const observer = await disco.observer('genel')
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await expect.poll(() => observer.voiceUsernames()).toEqual(['Mert'])

    await mert.page.locator('.server-rail-icon[title="Test Sunucusu"]').click()
    await mert.page.waitForTimeout(1500)
    await expect(mert.channelTitle()).toHaveText('genel')
    await expect(mert.voicePanel()).toBeVisible()
    await expect(mert.page.getByRole('list', { name: 'genel sesinde' })).toContainText('Mert')
    expect(observer.voiceUsernames()).toEqual(['Mert'])
  })

  test('giriş yapıp hiçbir kanala girmeyen kişi de yeni mesajdan haberdar oluyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const activity = mert.nextEvent('channel-activity')
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    await sendAs(ece, '@Mert neredesin')
    expect(await activity).toEqual({
      channelId: disco.channels.genel,
      serverId: disco.serverId,
      username: 'Ece',
      text: '@Mert neredesin',
      replyToUsername: null,
    })
  })

  test('H28: mikrofon sese girerken kapalı hazırlanıyor, açmak yeniden izin istemiyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await mert.openChannel('genel')
    await mert.joinVoice()
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: false, live: true }])

    // Açmak sadece anahtarı çeviriyor: yeni bir mikrofon izi açılmıyor.
    await mert.micOn()
    expect(await micTracks(mert)).toEqual([{ enabled: true, live: true }])
    await ece.expectHearingSomeone()
    await mert.mediaButton('Mikrofonu kapat').click()
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: false, live: true }])

    // Sesten çıkınca mikrofon tamamen bırakılıyor.
    await mert.leaveVoiceButton().click()
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: false, live: false }])
  })

  test('seste mikrofon cihazı değişince yenisi hemen kullanılıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await mert.openChannel('genel')
    await mert.joinVoice()
    await mert.micOn()

    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
    await mert.page.getByLabel('Giriş cihazı').selectOption({ index: 2 })
    await expect
      .poll(() => micTracks(mert))
      .toEqual([
        { enabled: true, live: false },
        { enabled: true, live: true },
      ])
    await mert.page.keyboard.press('Escape')
    await ece.expectHearingSomeone()
  })

  test('bas-konuş tuşu hatırlanıyor, sayfa öndeyken basılı tutunca mikrofon açılıyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { rememberMe: true })
    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Tuş atamaları' }).click()
    await mert.page.getByRole('button', { name: 'Bas-konuş tuşu ata' }).click()
    await mert.page.keyboard.press('KeyB')
    await expect(mert.page.locator('.settings-key')).toHaveText('B')

    await mert.page.reload()
    await expect(mert.page.locator('.user-panel')).toContainText('Bas-konuş: B')
    await mert.openChannel('genel')
    await mert.joinVoice()
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: false, live: true }])

    await mert.page.locator('.chat-messages').click()
    await mert.page.keyboard.down('KeyB')
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: true, live: true }])
    await mert.page.keyboard.up('KeyB')
    await expect.poll(() => micTracks(mert)).toEqual([{ enabled: false, live: true }])

    // Yazı yazarken aynı tuşa basmak mikrofonu açmıyor.
    await mert.page.getByLabel('Mesaj yaz').click()
    await mert.page.keyboard.down('KeyB')
    await mert.page.waitForTimeout(500)
    expect(await micTracks(mert)).toEqual([{ enabled: false, live: true }])
    await mert.page.keyboard.up('KeyB')
  })

  test('bas-konuşa farenin yan tuşu atanabiliyor, Esc vazgeçiyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await mert.page.getByRole('button', { name: 'Tuş atamaları' }).click()
    const assign = mert.page.getByRole('button', { name: 'Bas-konuş tuşu ata' })
    await assign.click()
    await mert.page.keyboard.press('Escape')
    await expect(assign).toBeVisible()
    await expect(mert.page.getByRole('dialog', { name: 'Ayarlar' })).toBeVisible()

    await assign.click()
    await mert.page.evaluate(() => window.dispatchEvent(new MouseEvent('mousedown', { button: 4 })))
    await expect(mert.page.locator('.settings-key')).toHaveText('Fare 5')
  })

  test('giriş hassasiyeti: elle seçilen eşiğin altındaki ses karşıya gitmiyor', async ({ disco }) => {
    const ece = await disco.user('Ece', {
      storage: { voiceSettings: JSON.stringify({ autoSensitivity: false, thresholdDb: -30 }) },
    })
    const mert = await disco.user('Mert')
    await ece.useSyntheticMic(SPEECH_DB)
    await joinVoiceTogether(ece, mert)
    await ece.micOn()
    await expectHears(mert, 0.05)

    await ece.setSyntheticMicLevel(ROOM_DB)
    await expectSilence(mert)

    // Eşik sesten çıkmadan değişiyor: en sola çekince sessiz ses de gidiyor.
    await openAudioSettings(ece)
    const threshold = ece.page.getByRole('slider', { name: 'Eşik' })
    await expect(threshold).toHaveValue('-30')
    await threshold.focus()
    await ece.page.keyboard.press('Home')
    await expect(ece.page.locator('.level-meter-value')).toHaveText('-80 dB')
    await expectHears(mert, 0.004)
    const saved = JSON.parse(await ece.probe(() => window.localStorage.getItem('voiceSettings')))
    expect(saved).toMatchObject({ autoSensitivity: false, thresholdDb: -80 })
  })

  test('otomatik hassasiyet: sürekli ortam sesi gitmiyor, üstüne çıkan konuşma gidiyor', async ({ disco }) => {
    const ece = await disco.user('Ece')
    const mert = await disco.user('Mert')
    await ece.useSyntheticMic(ROOM_DB)
    await joinVoiceTogether(ece, mert)
    await ece.micOn()
    await expectSilence(mert)

    await ece.setSyntheticMicLevel(SPEECH_DB)
    await expectHears(mert, 0.05)
    await ece.setSyntheticMicLevel(ROOM_DB)
    await expectSilence(mert)

    // Seste olduğu için ayarlardaki çubuk canlı. Disco'nun seçtiği eşik ortam
    // sesinin 12 dB üstü, en fazla -36 dB.
    await openAudioSettings(ece)
    await expect(ece.page.getByRole('switch', { name: 'Otomatik ayarla' })).toBeChecked()
    await expect(ece.page.getByText('Seste olduğun için seviye canlı gösteriliyor.')).toBeVisible()
    await expect(ece.page.locator('.level-meter-value')).toHaveText('-36 dB')
    const meter = ece.page.getByRole('meter', { name: 'Mikrofon seviyesi' })
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(-38)
    await expect(ece.page.locator('.level-meter--open')).toHaveCount(0)
    await ece.setSyntheticMicLevel(SPEECH_DB)
    await expect(ece.page.locator('.level-meter--open')).toHaveCount(1)
    await expect(ece.page.getByRole('slider', { name: 'Eşik' })).toHaveCount(0)
  })

  test('bas-konuşta hassasiyet kullanılmıyor: tuş basılıyken sessiz ses de gidiyor', async ({ disco }) => {
    const ece = await disco.user('Ece', {
      storage: { pttKey: 'KeyV', voiceSettings: JSON.stringify({ autoSensitivity: false, thresholdDb: -10 }) },
    })
    const mert = await disco.user('Mert')
    await ece.useSyntheticMic(ROOM_DB)
    await joinVoiceTogether(ece, mert)

    await ece.page.locator('.chat-messages').click()
    await ece.page.keyboard.down('KeyV')
    await expectHears(mert, 0.004)
    await ece.page.keyboard.up('KeyV')
    await expectSilence(mert)

    await openAudioSettings(ece)
    await expect(ece.page.getByText(/^Bas-konuş açık: tuşa bastığın sürece sesin gider/)).toBeVisible()
    await expect(ece.page.getByRole('slider', { name: 'Eşik' })).toHaveCount(0)
    await expect(ece.page.getByRole('switch', { name: 'Otomatik ayarla' })).toHaveCount(0)
  })

  test('ses işleme ayarı seste değişince mikrofon yeni ayarla açılıyor, açık kalıyor', async ({ disco }) => {
    const ece = await disco.user('Ece')
    const mert = await disco.user('Mert')
    await joinVoiceTogether(ece, mert)
    await ece.micOn()
    await mert.expectHearingSomeone()

    const audioTracks = () =>
      ece.probe(() =>
        window.__disco.mediaTracks
          .filter((t) => t.kind === 'audio')
          .map((t) => {
            const { noiseSuppression, echoCancellation, autoGainControl } = t.getSettings()
            return { live: t.readyState === 'live', enabled: t.enabled, noiseSuppression, echoCancellation, autoGainControl }
          })
      )
    expect(await audioTracks()).toEqual([
      { live: true, enabled: true, noiseSuppression: true, echoCancellation: true, autoGainControl: true },
    ])

    await openAudioSettings(ece)
    await ece.page.getByRole('switch', { name: 'Gürültü bastırma' }).click()
    await ece.page.getByRole('switch', { name: 'Yankı engelleme' }).click()
    await expect
      .poll(async () => {
        const tracks = await audioTracks()
        return { oldOnesClosed: tracks.slice(0, -1).every((t) => !t.live), current: tracks.at(-1) }
      })
      .toEqual({
        oldOnesClosed: true,
        current: { live: true, enabled: true, noiseSuppression: false, echoCancellation: false, autoGainControl: true },
      })
    await ece.page.keyboard.press('Escape')
    await expect(ece.mediaButton('Mikrofonu kapat')).toBeVisible()
    await mert.expectHearingSomeone()

    // Kapatıp açınca da yeni iz kullanılıyor.
    await ece.mediaButton('Mikrofonu kapat').click()
    await expect.poll(async () => (await audioTracks()).at(-1).enabled).toBe(false)
    await ece.micOn()
    await expect.poll(async () => (await audioTracks()).at(-1).enabled).toBe(true)
    const saved = JSON.parse(await ece.probe(() => window.localStorage.getItem('voiceSettings')))
    expect(saved).toMatchObject({ noiseSuppression: false, echoCancellation: false, autoGainControl: true })
  })

  test('sesten önce mikrofon testi seviye çubuğunu dolduruyor, bitince mikrofonu bırakıyor', async ({ disco }) => {
    const ece = await disco.user('Ece')
    await ece.useSyntheticMic(SPEECH_DB)
    await openAudioSettings(ece)
    const meter = ece.page.getByRole('meter', { name: 'Mikrofon seviyesi' })
    await expect(meter).toHaveAttribute('aria-valuetext', 'Ölçülmüyor')
    await ece.page.getByRole('button', { name: 'Mikrofonu test et' }).click()
    await expect(ece.page.locator('.level-meter--open')).toHaveCount(1)
    await expect(meter).not.toHaveAttribute('aria-valuetext', 'Ölçülmüyor')
    await ece.page.getByRole('button', { name: 'Testi durdur' }).click()
    await expect(meter).toHaveAttribute('aria-valuetext', 'Ölçülmüyor')
    await expect.poll(() => micTracks(ece)).toEqual([{ enabled: true, live: false }])
  })
})
