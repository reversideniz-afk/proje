// Faz 5: Discord'a yaklaşan özellikler ve bu fazda kapanan hatalar (H28, H33).
import { test, expect } from '../harness/fixtures.js'
import {
  PASSWORD,
  REGISTER_INVITE_CODE,
  SERVER_INVITE_CODE,
  expireCustomStatus,
  expireInvite,
  insertChat,
  insertMessages,
} from '../harness/seed.js'

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
// Bu testler ses kapısını ölçüyor: güçlü gürültü bastırma (RNNoise) sabit
// tonu "gürültü" sayıp kıstığı için onlarda kapalı (bkz. gurultu.spec.js).
const NO_RNNOISE = { strongNoiseSuppression: false }
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

// Masaüstü bildirimleri window.__notes'a kayda geçsin (gerçek bildirim
// gösterilmesin); son bildirim window.__lastNote.
function recordNotifications(user) {
  return user.page.evaluate(() => {
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
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
    await recordNotifications(mert)
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
    await mert.showDock()
    await mert.page.locator('.server-rail-icon[title="Test Sunucusu"]').click()
    await mert.openChannel('genel')
    await sendAs(ece, '@Mert buraya gel')
    const icon = mert.page.locator('.server-rail-icon[title="Mert Sunucusu"]')
    await expect(icon.locator('.server-rail-count')).toHaveText('1')
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

    await mert.showDock()
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
      dm: false,
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

  test('tek seferlik fotoğraf: kanalda olmayana okunmamış değil, ne olduğunu söyleyen bildirim gidiyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { storage: { notifySettings: JSON.stringify({ mode: 'all' }) } })
    await recordNotifications(mert)
    await mert.openChannel('oyun')
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    const bora = await disco.client('Bora')
    const activity = bora.nextEvent('channel-activity')

    const alganis = await disco.client('Alganis')
    await alganis.joinChannel(disco.serverId, disco.channels.genel)
    const response = await fetch(`${disco.socketUrl}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alganis.token}` },
      body: JSON.stringify({ channelId: disco.channels.genel, imageData: TINY_PNG, mimeType: 'image/png' }),
    })
    expect(response.status).toBe(200)

    // Kanaldaki fotoğrafı görüyor; kanalda olmayana sadece bildirim gidiyor.
    await expect(ece.page.locator('img.chat-photo')).toBeVisible()
    const text = '📷 Tek seferlik fotoğraf paylaştı (sadece o an kanalda olanlar görür)'
    expect(await activity).toMatchObject({ channelId: disco.channels.genel, serverId: disco.serverId, text, ephemeral: true })
    await expect.poll(() => mert.probe(() => window.__notes)).toEqual([{ title: 'Alganis · #genel', body: text }])
    await expect(mert.channelButton('genel')).not.toHaveClass(/channel-button--unread/)
  })

  test('ekran paylaşımı: seçilen kalite yakalamaya ve her bağlantıya uygulanıyor, paylaşırken değişebiliyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await joinVoiceTogether(mert, ece)

    await mert.mediaButton('Ekranı paylaş').click()
    const dialog = mert.page.getByRole('dialog', { name: 'Ekranını paylaş' })
    await expect(dialog.getByRole('radio', { name: '720p' })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('radio', { name: '1080p' }).click()
    await dialog.getByRole('radio', { name: '60 FPS' }).click()
    await expect(dialog.getByRole('status')).toContainText('Kişi başı en fazla 6,5 Mbit/sn')
    await dialog.getByRole('button', { name: 'Ekranı seç ve paylaş' }).click()
    await expect(mert.mediaButton('Ekran paylaşımını durdur')).toBeVisible()
    expect(await mert.probe(() => window.__disco.displayMediaConstraints.video)).toEqual({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    })
    await expect.poll(() => ece.page.locator('video.remote-video--screen').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)

    // Her açık bağlantının ekran kanalı (sabit kanal sırasında üçüncü).
    const screenSenders = () =>
      mert.probe(() =>
        window.__disco.pcs
          .filter((pc) => pc.connectionState !== 'closed')
          .map((pc) => {
            const sender = pc.getTransceivers()[2].sender
            const { maxBitrate, maxFramerate } = sender.getParameters().encodings[0]
            return { maxBitrate, maxFramerate, contentHint: sender.track?.contentHint }
          })
      )
    await expect.poll(screenSenders).toEqual([{ maxBitrate: 6_500_000, maxFramerate: 60, contentHint: 'motion' }])

    // Paylaşırken ayarlardan değişince hemen uygulanıyor.
    await openAudioSettings(mert)
    await expect(mert.page.getByText('Şu an paylaşıyorsun: değiştirdiğin ayar hemen uygulanır.')).toBeVisible()
    await mert.page.getByRole('radio', { name: '15 FPS' }).click()
    await mert.page.getByRole('radio', { name: 'Yazı, kod' }).click()
    await expect.poll(screenSenders).toEqual([{ maxBitrate: 2_500_000, maxFramerate: 15, contentHint: 'detail' }])
    await mert.page.keyboard.press('Escape')

    // Sonradan sese giren de aynı sınırla alıyor.
    const bora = await disco.user('Bora')
    await joinVoiceTogether(bora)
    await expect.poll(() => bora.page.locator('video.remote-video--screen').evaluate((v) => v.videoWidth)).toBeGreaterThan(0)
    await expect
      .poll(screenSenders)
      .toEqual([
        { maxBitrate: 2_500_000, maxFramerate: 15, contentHint: 'detail' },
        { maxBitrate: 2_500_000, maxFramerate: 15, contentHint: 'detail' },
      ])
    const saved = JSON.parse(await mert.probe(() => window.localStorage.getItem('screenQuality')))
    expect(saved).toEqual({ resolution: '1080', frameRate: 15, content: 'detail' })
  })

  test('yayını büyütünce sahneyi dolduruyor, diğerleri şeritte, sohbet altta açık kalıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await joinVoiceTogether(mert, ece)
    await mert.shareScreen()

    // Görüntü sahnesinde sadece açık kameralar ve ekranlar var: Ece'nin
    // kamerası şeritte kalıyor.
    await ece.cameraOn()
    const screenTile = ece.page.locator('.tile--screen')
    await expect(screenTile).toBeVisible()
    await screenTile.click()
    await expect(screenTile).toHaveClass(/video-tile--enlarged/)
    await expect(ece.page.locator('.stage-strip .tile')).toHaveCount(1)
    const tileBox = await screenTile.boundingBox()
    const stageBox = await ece.page.locator('.stage-area').boundingBox()
    expect(tileBox.width).toBeGreaterThan(stageBox.width - 40)

    // İzlerken yazışılabiliyor.
    await ece.send('yayın çok net')
    await expect(mert.chat).toContainText('yayın çok net')

    await ece.page.getByRole('button', { name: 'Mert: tam ekran' }).click()
    await expect.poll(() => ece.probe(() => document.fullscreenElement?.classList.contains('tile--screen'))).toBe(true)
    await ece.page.getByRole('button', { name: 'Mert: tam ekran' }).click()
    await expect.poll(() => ece.probe(() => document.fullscreenElement)).toBe(null)

    await screenTile.getByRole('button', { name: 'Küçült' }).click()
    await expect(ece.page.locator('.stage-strip')).toHaveCount(0)
    await expect(screenTile).not.toHaveClass(/video-tile--enlarged/)
  })

  test('sunucu rolleri: rolle kısıtlanan kanalı rolsüz göremiyor, içindeyse çıkarılıyor; rol silinince kanal herkese açılmıyor', async ({ disco }) => {
    const serverId = disco.serverId
    const genel = disco.channels.genel
    const owner = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    await mert.joinChannel(serverId, genel)
    const channelNames = async (client) => (await client.emitAck('server-channels', { serverId })).channels.map((c) => c.name)

    const created = await owner.emitAck('create-role', {
      serverId,
      name: 'Ekip',
      color: '#5cc08a',
      hoist: true,
      permissions: { manageChannels: true, uydurma: true },
    })
    expect(created).toMatchObject({
      success: true,
      role: {
        name: 'Ekip',
        color: '#5cc08a',
        hoist: true,
        permissions: { manageChannels: true, manageMessages: false, kickMembers: false, createInvites: false },
      },
    })
    const roleId = created.role.id
    // Rolleri sadece sahip yönetiyor; renk listeden.
    expect(await mert.emitAck('create-role', { serverId, name: 'Benim' })).toMatchObject({ success: false })
    expect(await owner.emitAck('create-role', { serverId, name: 'Renkli', color: 'red' })).toMatchObject({ success: false })
    expect(await mert.emitAck('set-member-roles', { serverId, username: 'Mert', roleIds: [roleId] })).toMatchObject({ success: false })

    expect(await owner.emitAck('set-member-roles', { serverId, username: 'Ece', roleIds: [roleId] })).toMatchObject({ success: true })
    expect((await ece.emitAck('server-channels', { serverId })).permissions).toMatchObject({
      isOwner: false,
      manageChannels: true,
      kickMembers: false,
    })
    const presence = await mert.emitAck('server-presence', { serverId })
    expect(presence.members.find((m) => m.username === 'Ece').roleIds).toEqual([roleId])

    // "Kanalları yönet" rolüyle Ece genel'i Ekip'e kısıtlıyor; içindeki Mert çıkarılıyor.
    expect(await mert.emitAck('update-channel', { serverId, channelId: genel, name: 'genel', allowedRoleIds: [] })).toMatchObject({
      success: false,
    })
    const kicked = mert.nextEvent('join-error')
    expect(await ece.emitAck('update-channel', { serverId, channelId: genel, name: 'genel', allowedRoleIds: [roleId] })).toMatchObject({
      success: true,
    })
    expect(await kicked).toBe('Bu kanala erişim yetkin kalmadı.')
    expect(await channelNames(mert)).not.toContain('genel')
    expect(await channelNames(ece)).toContain('genel')
    expect(await mert.emitAck('join-channel', { serverId, channelId: genel })).toMatchObject({ success: false })

    // Rol silinince kanal herkese açılmıyor: artık sadece sahip görüyor.
    expect(await owner.emitAck('delete-role', { serverId, roleId })).toMatchObject({ success: true })
    expect(await channelNames(ece)).not.toContain('genel')
    expect(await channelNames(mert)).not.toContain('genel')
    expect(await channelNames(owner)).toContain('genel')
    expect((await ece.emitAck('server-channels', { serverId })).permissions.manageChannels).toBe(false)
  })

  test('sunucu rolleri: üye çıkarma, davet ve mesaj silme yetkisi rolle veriliyor', async ({ disco }) => {
    const serverId = disco.serverId
    const owner = await disco.client('Alganis')
    const bora = await disco.client('Bora')
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')

    // Rol yokken hiçbiri yapılamıyor.
    expect(await bora.emitAck('create-invite', { serverId })).toMatchObject({ success: false })
    expect(await bora.emitAck('list-server-members', { serverId })).toMatchObject({ success: false })

    const { role } = await owner.emitAck('create-role', {
      serverId,
      name: 'Moderatör',
      permissions: { kickMembers: true, createInvites: true, manageMessages: true },
    })
    await owner.emitAck('set-member-roles', { serverId, username: 'Bora', roleIds: [role.id] })

    expect(await bora.emitAck('create-invite', { serverId })).toMatchObject({ success: true })
    const members = await bora.emitAck('list-server-members', { serverId })
    expect(members.members.find((m) => m.username === 'Bora').roleIds).toEqual([role.id])

    // Başkasının mesajını silebiliyor.
    for (const client of [bora, ece]) await client.joinChannel(serverId, disco.channels.genel)
    const sent = ece.nextEvent('new-message', (m) => m.text === 'silinecek')
    ece.socket.emit('send-message', { token: ece.token, text: 'silinecek' })
    const message = await sent
    const deleted = ece.nextEvent('messages-deleted')
    bora.socket.emit('delete-message', { token: bora.token, messageId: message.id })
    expect(await deleted).toEqual({ messageIds: [message.id] })

    // Üye çıkarabiliyor ama sahibi değil.
    expect(await bora.emitAck('remove-server-member', { serverId, targetUsername: 'Alganis' })).toMatchObject({ success: false })
    const listChanged = mert.nextEvent('server-list-changed')
    expect(await bora.emitAck('remove-server-member', { serverId, targetUsername: 'Mert' })).toMatchObject({ success: true })
    await listChanged
    expect((await mert.emitAck('list-my-servers', { token: mert.token })).servers).toEqual([])
  })

  test('sunucu rolleri arayüzde: rol oluşturup veriliyor, adı renkleniyor, rolle kanal kısıtlanıyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    for (const user of [alganis, mert, ece]) await user.openChannel('genel')

    await alganis.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    const nav = alganis.page.getByRole('navigation', { name: 'Ayar kategorileri' })
    await nav.getByRole('button', { name: 'Roller' }).click()
    await alganis.page.getByRole('button', { name: 'Rol oluştur' }).click()
    const dialog = alganis.page.getByRole('dialog', { name: 'Yeni rol' })
    await dialog.getByLabel('Rol adı').fill('Ekip')
    await dialog.getByRole('radio', { name: 'Renk #5cc08a' }).click()
    await dialog.getByRole('switch', { name: /Üye listesinde ayrı göster/ }).check()
    await dialog.getByRole('switch', { name: /Kanalları yönet/ }).check()
    await dialog.getByRole('button', { name: 'Rolü oluştur' }).click()
    await expect(alganis.page.getByRole('list', { name: 'Roller' })).toContainText('Ekip')

    await nav.getByRole('button', { name: 'Üyeler' }).click()
    const mertRow = alganis.page.locator('.settings-list-row', { hasText: 'Mert' })
    await mertRow.getByRole('button', { name: 'Roller' }).click()
    await alganis.page.getByRole('group', { name: 'Mert: roller' }).getByLabel('Ekip').check()
    await expect(mertRow.locator('.role-chip')).toHaveText('Ekip')
    await alganis.page.keyboard.press('Escape')

    // Üye listesinde kendi başlığı altında, adı rolün renginde.
    const ekip = ece.page.locator('.member-list-section', { has: ece.page.getByRole('heading', { name: 'Ekip — 1' }) })
    await expect(ekip).toContainText('Mert')
    await expect(ekip.locator('.member-item-name')).toHaveCSS('color', 'rgb(92, 192, 138)')

    // Mert artık kanal oluşturup düzenleyebiliyor: oyun'u Ekip'e kısıtlıyor.
    await mert.page.locator('.sidebar-server-button').click()
    await expect(mert.page.getByRole('menuitem', { name: 'Kanal oluştur' })).toBeVisible()
    await expect(mert.page.getByRole('menuitem', { name: 'Arkadaşını davet et' })).toHaveCount(0)
    await mert.page.keyboard.press('Escape')
    await mert.channelButton('oyun').hover()
    await mert.page.getByRole('button', { name: 'oyun kanalını düzenle' }).click()
    const edit = mert.page.getByRole('dialog', { name: '#oyun kanalı' })
    await edit.getByRole('radio', { name: 'Seçtiğim roller' }).click()
    await edit.getByLabel('Ekip').check()
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toHaveCount(0)

    await expect(ece.channelButton('oyun')).toHaveCount(0)
    await expect(mert.channelButton('oyun')).toBeVisible()
    await expect(alganis.channelButton('oyun')).toBeVisible()
    // Ece'nin menüsünde yetkisi olmayan işlemler yok.
    await ece.page.locator('.sidebar-server-button').click()
    await expect(ece.page.getByRole('menuitem', { name: 'Kanal oluştur' })).toHaveCount(0)
  })

  test('durum ve etkinlik: durum, özel durum, boşta ve oyun başkalarına görünüyor; görünmez çevrimdışı görünüyor', async ({ disco }) => {
    const serverId = disco.serverId
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    const eceSeenByMert = async () => (await mert.emitAck('server-presence', { serverId })).members.find((m) => m.username === 'Ece')
    expect(await eceSeenByMert()).toMatchObject({ online: true, status: 'online', customStatus: null, activity: null })

    expect(await ece.emitAck('set-status', { status: 'uydurma' })).toMatchObject({ success: false })
    expect(await ece.emitAck('set-status', { status: 'dnd' })).toMatchObject({ success: true })
    expect(await eceSeenByMert()).toMatchObject({ status: 'dnd' })

    expect(await ece.emitAck('set-custom-status', { text: 'x'.repeat(81) })).toMatchObject({ success: false })
    expect(await ece.emitAck('set-custom-status', { text: '  sınav haftası  ', expiresInHours: 4 })).toMatchObject({
      success: true,
      customStatus: { text: 'sınav haftası' },
    })
    const changed = mert.nextEvent('presence-changed')
    ece.socket.emit('set-activity', { name: 'VALORANT' })
    await changed
    expect(await eceSeenByMert()).toMatchObject({ customStatus: 'sınav haftası', activity: 'VALORANT' })

    // Bütün bağlantıları boşta olan "Çevrimiçi" boşta görünüyor; rahatsız
    // etmeyin boştayken de rahatsız etmeyin.
    ece.socket.emit('set-idle', { idle: true })
    await expect.poll(async () => (await eceSeenByMert()).status).toBe('dnd')
    await ece.emitAck('set-status', { status: 'online' })
    await expect.poll(async () => (await eceSeenByMert()).status).toBe('idle')
    ece.socket.emit('set-idle', { idle: false })
    await expect.poll(async () => (await eceSeenByMert()).status).toBe('online')

    // Görünmez: çevrimdışı; özel durum ve oyun da gizli.
    await ece.emitAck('set-status', { status: 'invisible' })
    expect(await eceSeenByMert()).toMatchObject({ online: false, status: 'offline', customStatus: null, activity: null })

    // Girişte kendi durumu ve özel durumu geliyor.
    const second = await disco.client()
    const login = await second.login('Ece')
    expect(login.presence).toMatchObject({ status: 'invisible', customStatus: { text: 'sınav haftası' } })

    // Süresi dolan özel durum gösterilmiyor; bağlantı kapanınca oyun gidiyor.
    await expireCustomStatus(disco.mongoUri, 'Ece')
    await ece.emitAck('set-status', { status: 'online' })
    expect(await eceSeenByMert()).toMatchObject({ customStatus: null, activity: 'VALORANT' })
    ece.close()
    await expect.poll(async () => (await eceSeenByMert()).activity).toBe(null)
  })

  test('durum menüsü: rahatsız etmeyin bildirimi susturuyor, özel durum görünüyor ve kalıcı', async ({ disco }) => {
    const ece = await disco.user('Ece', { rememberMe: true, storage: { notifySettings: JSON.stringify({ mode: 'all' }) } })
    await recordNotifications(ece)
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await ece.openChannel('oyun')

    await ece.page.getByRole('button', { name: /^Durumun: Çevrimiçi/ }).click()
    await ece.page.getByRole('menuitemradio', { name: /Rahatsız etmeyin/ }).click()
    await expect(ece.page.locator('.user-panel')).toContainText('Rahatsız etmeyin')
    const eceInMertsList = mert.page.locator('.member-item', { hasText: 'Ece' })
    await expect(eceInMertsList.locator('.status-dot--dnd')).toHaveCount(1)

    // Bahsedilince sayı çıkıyor ama bildirim yok.
    const bora = await disco.client('Bora')
    await bora.joinChannel(disco.serverId, disco.channels.genel)
    await sendAs(bora, '@Ece genele bak')
    await expect(ece.channelButton('genel').locator('.mention-badge')).toHaveText('1')
    await ece.page.waitForTimeout(500)
    expect(await ece.probe(() => window.__notes)).toEqual([])

    await ece.page.getByRole('button', { name: /^Durumun:/ }).click()
    await ece.page.getByRole('menuitem', { name: 'Özel durum ayarla' }).click()
    const dialog = ece.page.getByRole('dialog', { name: 'Özel durum' })
    await dialog.getByLabel('Ne yapıyorsun?').fill('akşam 9 gibi gelirim')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(ece.page.locator('.user-panel')).toContainText('akşam 9 gibi gelirim')
    await expect(eceInMertsList).toContainText('akşam 9 gibi gelirim')

    // Yeniden açınca ikisi de duruyor.
    await ece.page.reload()
    await expect(ece.page.locator('.user-panel')).toContainText('akşam 9 gibi gelirim')
    await expect(ece.page.getByRole('button', { name: /^Durumun: Rahatsız etmeyin/ })).toBeVisible()
    await ece.page.getByRole('button', { name: /^Durumun:/ }).click()
    await ece.page.getByRole('menuitem', { name: 'Özel durumu sil' }).click()
    await expect(eceInMertsList).not.toContainText('akşam 9 gibi gelirim')
  })

  test('kullanılmayınca kendiliğinden boşta görünüyor, dokununca geri dönüyor', async ({ disco }) => {
    const ece = await disco.user('Ece', { storage: { discoIdleAfterMs: '1500' } })
    const mert = await disco.client('Mert')
    const eceStatus = async () =>
      (await mert.emitAck('server-presence', { serverId: disco.serverId })).members.find((m) => m.username === 'Ece').status
    await expect.poll(eceStatus, { timeout: 10_000 }).toBe('idle')
    await ece.page.mouse.move(100, 100)
    await ece.page.mouse.move(300, 200)
    await expect.poll(eceStatus, { timeout: 10_000 }).toBe('online')
  })

  test('arkadaşlık ve özel mesaj: istek, kabul, konuşma, okunmamış, üçüncü kişi giremiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    const yolcu = await newUser(disco, 'Yolcu')

    // Ortak sunucu yok, arkadaş değiller: özel mesaj açılamıyor.
    expect(await yolcu.emitAck('open-dm', { username: 'Mert' })).toMatchObject({ success: false })

    // İstek (adın büyük/küçük harfi önemli değil), tekrarı reddediliyor.
    const notified = mert.nextEvent('friends-changed')
    expect(await yolcu.emitAck('send-friend-request', { username: 'mert' })).toMatchObject({
      success: true,
      accepted: false,
      username: 'Mert',
    })
    await notified
    expect(await yolcu.emitAck('send-friend-request', { username: 'Mert' })).toMatchObject({ success: false })
    expect(await yolcu.emitAck('send-friend-request', { username: 'Yolcu' })).toMatchObject({ success: false })
    expect(await mert.emitAck('list-friends')).toMatchObject({ incoming: [{ username: 'Yolcu' }], outgoing: [], friends: [] })
    expect(await mert.emitAck('respond-friend-request', { username: 'Yolcu', accept: true })).toMatchObject({ success: true })
    expect((await yolcu.emitAck('list-friends')).friends).toMatchObject([{ username: 'Mert', online: true, status: 'online' }])

    // Özel mesaj: iki taraf açınca aynı konuşma.
    const opened = await yolcu.emitAck('open-dm', { username: 'Mert' })
    expect(opened).toMatchObject({ success: true, username: 'Mert' })
    expect((await mert.emitAck('open-dm', { username: 'Yolcu' })).channelId).toBe(opened.channelId)
    expect(await ece.emitAck('join-channel', { serverId: null, channelId: opened.channelId })).toMatchObject({ success: false })

    expect(await yolcu.emitAck('join-channel', { serverId: null, channelId: opened.channelId })).toMatchObject({ success: true })
    const activity = mert.nextEvent('channel-activity', (a) => a.channelId === opened.channelId)
    yolcu.socket.emit('send-message', { token: yolcu.token, text: 'selam, akşam var mısın' })
    expect(await activity).toMatchObject({ dm: true, username: 'Yolcu', text: 'selam, akşam var mısın' })
    expect((await mert.emitAck('list-dms')).dms).toMatchObject([{ id: opened.channelId, username: 'Yolcu', unread: 1 }])

    // Aynı sunucudakiler arkadaş olmadan da yazışabiliyor.
    expect(await ece.emitAck('open-dm', { username: 'Mert' })).toMatchObject({ success: true })

    // Arkadaşlıktan çıkarma ve istek geri alma.
    expect(await mert.emitAck('remove-friend', { username: 'Yolcu' })).toMatchObject({ success: true })
    expect((await yolcu.emitAck('list-friends')).friends).toEqual([])
    await ece.emitAck('send-friend-request', { username: 'Bora' })
    expect(await ece.emitAck('remove-friend', { username: 'Bora' })).toMatchObject({ success: true })
    expect((await ece.emitAck('list-friends')).outgoing).toEqual([])
  })

  test('özel mesajda sese giren karşıdakini arıyor, çıkınca arama bitiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    const { channelId } = await mert.emitAck('open-dm', { username: 'Ece' })
    await mert.emitAck('join-channel', { serverId: null, channelId })
    const call = ece.nextEvent('dm-call')
    expect(await mert.emitAck('join-voice', { token: mert.token, channelId })).toMatchObject({ success: true })
    expect(await call).toEqual({ channelId, from: 'Mert' })
    const ended = ece.nextEvent('dm-call-ended')
    mert.socket.emit('leave-voice')
    expect(await ended).toEqual({ channelId })
  })

  test('özel mesaj arayüzde: üye listesinden yaz, ana sayfada okunmamış, arkadaş ekle, arama, sunucuya dönüş', async ({ disco }) => {
    const ece = await disco.user('Ece')
    const mert = await disco.user('Mert')
    for (const user of [ece, mert]) await user.openChannel('genel')

    // Ece üye listesinden Mert'e yazıyor.
    await ece.page.getByRole('button', { name: 'Mert: ses seviyesini ayarla' }).click()
    await ece.page.getByRole('button', { name: 'Mesaj gönder' }).click()
    await expect(ece.channelTitle()).toHaveText('Mert')
    await ece.send('akşam 9da sese gel')

    // Mert'in disko topunda sayı; ana sayfada konuşma okunmamış.
    const home = mert.page.getByRole('button', { name: /^Özel mesajlar, 1 yeni/ })
    await expect(home).toBeVisible()
    await mert.showDock()
    await home.click()
    const conversation = mert.page.getByRole('list', { name: 'Konuşmalar' }).getByRole('button', { name: /Ece/ })
    await expect(conversation.locator('.mention-badge')).toHaveText('1')
    await conversation.click()
    await expect(mert.chat).toContainText('akşam 9da sese gel')
    await expect(mert.page.getByRole('button', { name: /^Özel mesajlar$/ })).toBeVisible()

    // Arama: Mert "Sesli ara", Ece'de bant çıkıyor, katılınca ikisi seste.
    await mert.page.getByRole('button', { name: 'Sesli ara' }).click()
    const banner = ece.page.getByRole('alert').filter({ hasText: 'Mert seni arıyor' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Katıl' }).click()
    await expect(ece.leaveVoiceButton()).toBeVisible()
    await expect(ece.voicePanel()).toContainText('@Mert')
    await ece.leaveVoiceButton().click()

    // Arkadaş ekle: Ece Bora'ya istek gönderiyor, Bora kabul edince listede.
    await ece.showDock()
    await ece.page.getByRole('button', { name: /^Özel mesajlar/ }).click()
    await ece.page.getByRole('tab', { name: 'Arkadaş ekle' }).click()
    await ece.page.getByLabel('Kullanıcı adı').fill('bora')
    await ece.page.getByRole('button', { name: 'İstek gönder' }).click()
    await expect(ece.page.locator('.friend-add').getByRole('status')).toContainText('İstek gönderildi: Bora')
    const bora = await disco.client('Bora')
    await bora.emitAck('respond-friend-request', { username: 'Ece', accept: true })
    await ece.page.getByRole('tab', { name: 'Tümü' }).click()
    await expect(ece.page.locator('.friend-row', { hasText: 'Bora' })).toBeVisible()

    // Sunucuya dönünce son kanal açılıyor.
    await ece.showDock()
    await ece.page.getByRole('button', { name: /^Test Sunucusu/ }).click()
    await expect(ece.channelTitle()).toHaveText('genel')
  })

  test('sabitleme ve arama: sadece yetkili sabitliyor; arama kişiye ve görebildiği kanallara göre', async ({ disco }) => {
    const serverId = disco.serverId
    await insertChat(disco.mongoUri, disco.channels.ozel, [{ username: 'Bora', text: 'gizli plan: cumartesi turnuva', minutesAgo: 5 }])
    await insertChat(disco.mongoUri, disco.channels.oyun, [{ username: 'Ece', text: 'turnuva için takım kuralım', minutesAgo: 4 }])
    const owner = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    for (const client of [owner, mert, ece]) await client.joinChannel(serverId, disco.channels.genel)
    const message = await sendAs(ece, 'akşam turnuva saat 9da')

    // Sabitleme: Mert'in yetkisi yok, sunucu sahibi sabitliyor ve kaldırıyor.
    expect(await mert.emitAck('toggle-pin', { messageId: message.id })).toMatchObject({ success: false })
    const pinned = mert.nextEvent('message-pin-changed')
    expect(await owner.emitAck('toggle-pin', { messageId: message.id })).toMatchObject({ success: true })
    expect(await pinned).toMatchObject({ messageId: message.id, pinned: { by: 'Alganis' } })
    const pins = await mert.emitAck('list-pins', { channelId: disco.channels.genel })
    expect(pins.messages).toMatchObject([{ id: message.id, text: 'akşam turnuva saat 9da', pinned: { by: 'Alganis' } }])
    await owner.emitAck('toggle-pin', { messageId: message.id })
    expect((await mert.emitAck('list-pins', { channelId: disco.channels.genel })).messages).toEqual([])

    // Arama: Mert VIP kanalını görmüyor, Ece görüyor; "from:" kişiye göre.
    const texts = async (client, query) =>
      (await client.emitAck('search-messages', { serverId, query })).messages.map((m) => m.text).sort()
    expect(await texts(mert, 'turnuva')).toEqual(['akşam turnuva saat 9da', 'turnuva için takım kuralım'])
    expect(await texts(ece, 'TURNUVA')).toEqual(['akşam turnuva saat 9da', 'gizli plan: cumartesi turnuva', 'turnuva için takım kuralım'])
    expect(await texts(ece, 'turnuva from:bora')).toEqual(['gizli plan: cumartesi turnuva'])
    expect(await mert.emitAck('search-messages', { serverId, query: 'a' })).toMatchObject({ success: false })
    expect(await mert.emitAck('list-pins', { channelId: disco.channels.ozel })).toMatchObject({ success: false })
  })

  test('arayüzde arama sonucu eski mesaja götürüyor; sabitlenen mesaj listede', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [
      { username: 'Ece', text: 'mercimek çorbası tarifi: önce soğanı kavur', minutesAgo: 90 },
    ])
    await insertMessages(disco.mongoUri, disco.channels.genel, 'Bora', 120)
    const alganis = await disco.user('Alganis')
    await alganis.openChannel('genel')
    await expect(alganis.chat).toContainText('mesaj 120')
    await expect(alganis.chat).not.toContainText('mercimek')

    await alganis.page.getByRole('searchbox', { name: /içinde ara/ }).fill('mercimek')
    await alganis.page.keyboard.press('Enter')
    const panel = alganis.page.getByRole('complementary', { name: 'Arama sonuçları' })
    await expect(panel).toContainText('mercimek çorbası')
    await panel.getByRole('button', { name: /mercimek/ }).click()
    const old = alganis.chat.locator('.chat-message', { hasText: 'mercimek çorbası' })
    await expect(old).toBeVisible()
    await expect(old).toBeInViewport()

    // Sabitle: mesajın araç çubuğundan, başlıktaki düğmeyle listede.
    await old.hover()
    await old.getByRole('button', { name: 'Sabitle' }).click()
    await expect(old.locator('.chat-message-pinned')).toBeVisible()
    await alganis.page.getByRole('button', { name: 'Sabitlenmiş mesajlar' }).click()
    await expect(alganis.page.getByRole('complementary', { name: 'Sabitlenmiş mesajlar' })).toContainText('mercimek çorbası')
  })

  test('ses efektleri: sesteki herkese gidiyor; seste olmayan, bilinmeyen ses ve art arda çalma reddediliyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    for (const client of [mert, ece]) await client.joinChannel(disco.serverId, disco.channels.genel)
    expect(await mert.emitAck('play-sound', { soundId: 'alkis' })).toMatchObject({ success: false })
    for (const client of [mert, ece]) await client.emitAck('join-voice', { token: client.token, channelId: disco.channels.genel })

    const heard = ece.nextEvent('sound-played')
    expect(await mert.emitAck('play-sound', { soundId: 'alkis' })).toMatchObject({ success: true })
    expect(await heard).toEqual({ soundId: 'alkis', username: 'Mert' })
    expect(await mert.emitAck('play-sound', { soundId: 'davul' })).toMatchObject({ success: false, message: 'Biraz bekle.' })
    expect(await ece.emitAck('play-sound', { soundId: 'uydurma' })).toMatchObject({ success: false })
  })

  test('ses efektleri arayüzde: panelden çalınca karşıda çalıyor ve kimin çaldığı görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await joinVoiceTogether(mert, ece)
    const tonesBefore = await ece.probe(() => window.__disco.tones.length)

    await mert.page.getByRole('button', { name: 'Ses efektleri' }).click()
    await mert.page.getByRole('menuitem', { name: /Ba dum tss/ }).click()
    await expect(ece.page.locator('.stage-toast')).toContainText('Mert')
    await expect(ece.page.locator('.stage-toast')).toContainText('Ba dum tss')
    // Efekt karşıda çaldı (iki davul vuruşu iki tonla üretiliyor).
    await expect.poll(() => ece.probe(() => window.__disco.tones.length)).toBeGreaterThanOrEqual(tonesBefore + 2)
  })

  test('anket ve etkinlik: tek seçimde oy değişiyor, çokta ayrı; biten ankete oy yok; katılım ve yaklaşanlar', async ({ disco }) => {
    const mert = await disco.client('Mert')
    const ece = await disco.client('Ece')
    for (const client of [mert, ece]) await client.joinChannel(disco.serverId, disco.channels.genel)
    expect(await mert.emitAck('create-poll', { question: 'Tek seçenek', options: ['Sadece bu'] })).toMatchObject({ success: false })

    const posted = ece.nextEvent('new-message', (m) => m.poll)
    const { messageId } = await mert.emitAck('create-poll', { question: 'Cumartesi ne oynayalım?', options: ['Valorant', 'CS2', 'LoL'] })
    expect((await posted).poll).toMatchObject({ question: 'Cumartesi ne oynayalım?', multiple: false, closed: false })
    const votes = async (client, index) => {
      const updated = mert.nextEvent('poll-updated')
      await client.emitAck('vote-poll', { messageId, optionIndex: index })
      return (await updated).poll.options.map((o) => o.votes)
    }
    expect(await votes(ece, 0)).toEqual([['Ece'], [], []])
    expect(await votes(ece, 1)).toEqual([[], ['Ece'], []])
    expect(await votes(ece, 1)).toEqual([[], [], []])
    expect(await votes(mert, 2)).toEqual([[], [], ['Mert']])

    // Sadece açan bitiriyor; biten ankete oy verilmiyor; anket düzenlenmiyor.
    expect(await ece.emitAck('close-poll', { messageId })).toMatchObject({ success: false })
    expect(await mert.emitAck('close-poll', { messageId })).toMatchObject({ success: true })
    expect(await ece.emitAck('vote-poll', { messageId, optionIndex: 0 })).toMatchObject({ success: false, message: 'Anket bitti.' })
    mert.socket.emit('edit-message', { token: mert.token, messageId, newText: 'değişti' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(ece.received('message-edited')).toEqual([])

    // Çok seçimli.
    const multi = await mert.emitAck('create-poll', { question: 'Hangi akşamlar uygun?', options: ['Cuma', 'Cumartesi'], multiple: true })
    await ece.emitAck('vote-poll', { messageId: multi.messageId, optionIndex: 0 })
    const both = mert.nextEvent('poll-updated', (u) => u.messageId === multi.messageId && u.poll.options[1].votes.length > 0)
    await ece.emitAck('vote-poll', { messageId: multi.messageId, optionIndex: 1 })
    expect((await both).poll.options.map((o) => o.votes)).toEqual([['Ece'], ['Ece']])

    // Etkinlik: geçmiş tarih reddediliyor; açan "katılıyorum"; katılım değişiyor.
    const past = new Date(Date.now() - 3_600_000).toISOString()
    expect(await mert.emitAck('create-event', { title: 'Dün', startsAt: past })).toMatchObject({ success: false })
    const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString()
    const event = await mert.emitAck('create-event', { title: 'Valorant turnuvası', startsAt, description: '5v5, herkes gelsin' })
    expect(event).toMatchObject({ success: true })
    const listed = await ece.emitAck('list-events', { serverId: disco.serverId })
    expect(listed.events).toMatchObject([{ id: event.messageId, title: 'Valorant turnuvası', going: ['Mert'], maybe: [] }])
    const maybe = mert.nextEvent('event-updated')
    await ece.emitAck('rsvp-event', { messageId: event.messageId, choice: 'maybe' })
    expect((await maybe).event).toMatchObject({ going: ['Mert'], maybe: ['Ece'] })
    const going = mert.nextEvent('event-updated')
    await ece.emitAck('rsvp-event', { messageId: event.messageId, choice: 'going' })
    expect((await going).event).toMatchObject({ going: ['Mert', 'Ece'], maybe: [] })
  })

  test('anket ve etkinlik arayüzde: + menüsünden oluşturuluyor, oy ve katılım karşıda görünüyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    for (const user of [mert, ece]) await user.openChannel('genel')

    await mert.page.getByRole('button', { name: 'Ekle', exact: true }).click()
    await mert.page.getByRole('menuitem', { name: 'Anket oluştur' }).click()
    const pollDialog = mert.page.getByRole('dialog', { name: 'Anket oluştur' })
    await pollDialog.getByLabel('Soru').fill('Cumartesi ne oynayalım?')
    await pollDialog.getByLabel('Seçenek 1', { exact: true }).fill('Valorant')
    await pollDialog.getByLabel('Seçenek 2', { exact: true }).fill('CS2')
    await pollDialog.getByRole('button', { name: 'Anketi gönder' }).click()

    const elcePoll = ece.page.getByRole('group', { name: 'Anket: Cumartesi ne oynayalım?' })
    await elcePoll.getByRole('button', { name: /Valorant/ }).click()
    await expect(elcePoll.getByRole('button', { name: /Valorant/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(mert.page.getByRole('group', { name: 'Anket: Cumartesi ne oynayalım?' })).toContainText('1 · %100')

    const when = new Date(Date.now() + 2 * 86_400_000)
    const pad = (n) => String(n).padStart(2, '0')
    const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T20:00`
    await mert.page.getByRole('button', { name: 'Ekle', exact: true }).click()
    await mert.page.getByRole('menuitem', { name: 'Etkinlik planla' }).click()
    const eventDialog = mert.page.getByRole('dialog', { name: 'Etkinlik planla' })
    await eventDialog.getByLabel('Ne yapılacak').fill('Valorant turnuvası')
    await eventDialog.getByLabel('Ne zaman').fill(local)
    await eventDialog.getByRole('button', { name: 'Etkinliği paylaş' }).click()

    const eceEvent = ece.page.getByRole('group', { name: 'Etkinlik: Valorant turnuvası' })
    await eceEvent.getByRole('button', { name: /Belki/ }).click()
    await expect(mert.page.getByRole('group', { name: 'Etkinlik: Valorant turnuvası' })).toContainText('Belki · 1')
    await expect(ece.page.getByRole('list', { name: 'Yaklaşan etkinlikler' })).toContainText('Valorant turnuvası')
  })

  test('giriş hassasiyeti: elle seçilen eşiğin altındaki ses karşıya gitmiyor', async ({ disco }) => {
    const ece = await disco.user('Ece', {
      storage: { voiceSettings: JSON.stringify({ ...NO_RNNOISE, autoSensitivity: false, thresholdDb: -30 }) },
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
    const ece = await disco.user('Ece', { storage: { voiceSettings: JSON.stringify(NO_RNNOISE) } })
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
      storage: { pttKey: 'KeyV', voiceSettings: JSON.stringify({ ...NO_RNNOISE, autoSensitivity: false, thresholdDb: -10 }) },
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
    await ece.page.getByRole('switch', { name: /^Tarayıcının gürültü bastırması/ }).click()
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
    const ece = await disco.user('Ece', { storage: { voiceSettings: JSON.stringify(NO_RNNOISE) } })
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
