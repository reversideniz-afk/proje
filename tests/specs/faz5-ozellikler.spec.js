// Faz 5: Discord'a yaklaşan özellikler ve bu fazda kapanan hatalar (H28).
import { test, expect } from '../harness/fixtures.js'

const micTracks = (user) =>
  user.probe(() =>
    window.__disco.mediaTracks
      .filter((t) => t.kind === 'audio')
      .map((t) => ({ enabled: t.enabled, live: t.readyState === 'live' }))
  )

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
})
