// Faz 4: tasarım yenilemesiyle düzeltilen hataların (H15, H21–H24, H26, H27)
// ve yeni arayüz davranışlarının kalıcı testleri.
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD, REGISTER_INVITE_CODE, SERVER_INVITE_CODE, insertChat } from '../harness/seed.js'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// WCAG kontrast oranı; tarayıcının hesapladığı "rgb(...)" renklerinden.
function contrastInPage([foreground, background]) {
  const parse = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number)
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [a, b] = [luminance(parse(foreground)), luminance(parse(background))].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

async function contrastOf(page, textSelector, backgroundSelector) {
  const colors = await page.evaluate(
    ([text, background]) => [
      getComputedStyle(document.querySelector(text)).color,
      getComputedStyle(document.querySelector(background)).backgroundColor,
    ],
    [textSelector, backgroundSelector]
  )
  return contrastInPage(colors)
}

async function registerAndJoin(disco, username) {
  const client = await disco.client()
  const registered = await client.emitAck('register', { username, password: PASSWORD, inviteCode: REGISTER_INVITE_CODE })
  expect(registered.success).toBe(true)
  await client.login(username)
  return client
}

test.describe('Faz 4: tasarım', { tag: '@faz4' }, () => {
  test('H15: mesaj araç çubuğuna klavyeyle ulaşılıp tepki verilebiliyor', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [{ username: 'Ece', text: 'klavyeyle tepki ver', minutesAgo: 2 }])
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const message = mert.chat.locator('.chat-message', { hasText: 'klavyeyle tepki ver' })
    const toolbar = message.getByRole('toolbar')
    await expect(toolbar).toHaveCSS('opacity', '0')

    // Yazma alanından geriye doğru: fotoğraf düğmesi, sonra son mesajın
    // araç çubuğu (Metni kopyala, Yanıtla, Tepki ekle).
    await mert.page.getByLabel('Mesaj yaz').focus()
    const react = message.getByRole('button', { name: 'Tepki ekle' })
    for (let i = 0; i < 6 && !(await react.evaluate((el) => el === document.activeElement)); i++) {
      await mert.page.keyboard.press('Shift+Tab')
    }
    await expect(react).toBeFocused()
    await expect(toolbar).toHaveCSS('opacity', '1')

    await mert.page.keyboard.press('Enter')
    await expect(message.getByRole('menuitem', { name: '👍' })).toBeFocused()
    await mert.page.keyboard.press('Enter')
    await expect(message.getByRole('button', { name: /👍 1 kişi: Mert/ })).toBeVisible()
  })

  test('H15: dokunmatikte uzun basınca mesaj menüsü açılıyor, ses ayarı tıklamayla açılıyor', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [{ username: 'Ece', text: 'uzun bas', minutesAgo: 2 }])
    const mert = await disco.user('Mert', { viewport: { width: 390, height: 844 } })
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await mert.channelButton('genel').click()
    const message = mert.chat.locator('.chat-message', { hasText: 'uzun bas' })
    await message.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true })
    await expect(message).toHaveClass(/is-active/)
    await expect(message.getByRole('toolbar')).toHaveCSS('opacity', '1')

    // Ses seviyesi eskiden sadece sağ tıkla açılıyordu.
    await mert.page.setViewportSize({ width: 1280, height: 800 })
    await mert.page.getByRole('button', { name: 'Ece: ses seviyesini ayarla' }).click()
    const slider = mert.page.getByRole('slider', { name: 'Ece ses seviyesi' })
    await expect(slider).toBeVisible()
    await slider.fill('150')
    await expect(mert.page.locator('.volume-popup-value')).toHaveText('150%')
    await mert.page.keyboard.press('Escape')
    await expect(slider).toHaveCount(0)
  })

  test('H21: yazarken bağlantısı kopanın "yazıyor" göstergesi kalkıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    ece.socket.emit('typing-start', { token: ece.token })
    const typing = mert.page.locator('.chat-typing')
    await expect(typing).toHaveText('Ece yazıyor…')

    ece.close()
    // Sunucu kopan kişi için "yazmayı bıraktı" gönderiyor; istemcinin 6
    // saniyelik kendi süresinden önce kalkmalı.
    await expect(typing).toHaveText('', { timeout: 3000 })
  })

  test('H21: "yazmayı bıraktı" hiç gelmezse gösterge 6 saniyede kendiliğinden kalkıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    ece.socket.emit('typing-start', { token: ece.token })
    const typing = mert.page.locator('.chat-typing')
    await expect(typing).toHaveText('Ece yazıyor…')
    await expect(typing).toHaveText('', { timeout: 8000 })
  })

  test('H21: uzun süre yazan kişi karşı tarafta "yazıyor" görünmeye devam ediyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    const input = mert.page.getByLabel('Mesaj yaz')
    for (let i = 0; i < 10; i++) {
      await input.pressSequentially('ab')
      await mert.page.waitForTimeout(900)
    }
    // Yaklaşık 9 saniye boyunca 4 saniyede bir yenileniyor.
    expect(ece.received('user-typing').length).toBeGreaterThanOrEqual(2)
    expect(ece.received('user-stopped-typing')).toHaveLength(0)
  })

  test('H22: @ önerisi Türkçe harfli isimlerde ve metnin ortasında çalışıyor', async ({ disco }) => {
    const sule = await registerAndJoin(disco, 'Şule')
    expect((await sule.emitAck('join-server-by-invite', { token: sule.token, inviteCode: SERVER_INVITE_CODE })).success).toBe(true)
    sule.close()

    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const input = mert.page.getByLabel('Mesaj yaz')
    await input.fill('selam @şu')
    const options = mert.page.getByRole('listbox', { name: 'Etiketlenecek kişi' }).getByRole('option')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('@Şule')
    await mert.page.keyboard.press('Enter')
    await expect(input).toHaveValue('selam @Şule ')

    // Metnin ortasına etiket: imleç "bu akşam" kelimesinin önünde.
    await input.fill('bu akşam gel')
    await input.evaluate((el) => el.setSelectionRange(9, 9))
    await mert.page.keyboard.type('@ŞU')
    await mert.page.keyboard.press('Tab')
    await expect(input).toHaveValue('bu akşam @Şule gel')
  })

  test('H23: saat metinden ayrı, araç çubuğu satırı kaydırmıyor, soluk metin okunaklı', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [{ username: 'Ece', text: 'düzen testi', minutesAgo: 2 }])
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const message = mert.chat.locator('.chat-message', { hasText: 'düzen testi' })
    const author = await message.locator('.chat-message-author').boundingBox()
    const time = await message.locator('.chat-message-time').boundingBox()
    expect(time.x - (author.x + author.width)).toBeGreaterThanOrEqual(6)

    const text = message.locator('.chat-message-text')
    const before = await text.boundingBox()
    await message.hover()
    await expect(message.getByRole('toolbar')).toHaveCSS('opacity', '1')
    expect(await text.boundingBox()).toEqual(before)

    expect(await contrastOf(mert.page, '.chat-message-time', '.chat-panel')).toBeGreaterThanOrEqual(4.5)
    expect(await contrastOf(mert.page, '.member-list-title', '.member-list-panel')).toBeGreaterThanOrEqual(4.5)
    expect(
      await contrastOf(mert.page, '.member-item--offline .member-item-name', '.member-list-panel')
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('H24: sunucusu olmayan kişiye ne yapacağı doğru söyleniyor', async ({ disco }) => {
    ;(await registerAndJoin(disco, 'Yalnız')).close()
    const user = await disco.user('Yalnız')
    await expect(user.page.getByText('Henüz bir sunucun yok')).toBeVisible()
    await expect(user.page.getByText(/sağdaki/)).toHaveCount(0)
    await user.page.getByRole('button', { name: 'Sunucu oluştur', exact: true }).click()
    const dialog = user.page.getByRole('dialog', { name: 'Sunucu oluştur ya da katıl' })
    await expect(dialog.getByRole('tab', { name: 'Oluştur' })).toHaveAttribute('aria-selected', 'true')
    await dialog.getByLabel('Sunucu adı').fill('Yalnızın Sunucusu')
    await dialog.getByRole('button', { name: 'Sunucu oluştur', exact: true }).click()
    await expect(user.page.locator('.server-rail-icon[title="Yalnızın Sunucusu"]')).toBeVisible()
  })

  test('H26: avatarlar listelerde adresle gidiyor, resim önbelleğe alınabiliyor', async ({ disco }) => {
    const ece = await disco.client('Ece')
    const saved = ece.nextEvent('avatar-saved')
    ece.socket.emit('set-avatar', { token: ece.token, imageData: TINY_PNG, mimeType: 'image/png' })
    const { avatarUrl } = await saved
    expect(avatarUrl).toMatch(/^\/api\/avatars\/Ece\?v=\w+$/)

    const mert = await disco.client('Mert')
    const presence = await mert.emitAck('server-presence', { token: mert.token, serverId: disco.serverId })
    const eceRow = presence.members.find((m) => m.username === 'Ece')
    expect(eceRow).toMatchObject({ avatarUrl })
    expect(eceRow).not.toHaveProperty('avatarData')
    expect(JSON.stringify(presence).length).toBeLessThan(2000)

    const image = await fetch(`${disco.socketUrl}${avatarUrl}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('cache-control')).toContain('immutable')
    const stale = await fetch(`${disco.socketUrl}/api/avatars/Ece?v=eski`)
    expect(stale.headers.get('cache-control')).toBe('no-cache')
    expect((await fetch(`${disco.socketUrl}/api/avatars/Bora`)).status).toBe(404)

    // Sunucunun adresinden açıldığında betik çalıştırabilecek SVG kabul edilmiyor.
    ece.socket.emit('set-avatar', {
      token: ece.token,
      imageData: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`,
      mimeType: 'image/svg+xml',
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(ece.received('avatar-saved')).toHaveLength(1)

    // Arayüz resmi bu adresten yüklüyor.
    const bora = await disco.user('Bora')
    await bora.openChannel('genel')
    const avatar = bora.page.locator('.member-item', { hasText: 'Ece' }).locator('img')
    await expect(avatar).toHaveAttribute('src', new RegExp(`/api/avatars/Ece\\?v=`))
    await expect.poll(() => avatar.evaluate((img) => img.naturalWidth)).toBe(1)
  })

  test('H27: telefonda sayfa görünen alana sığıyor, koyu renk şeması bildiriliyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { viewport: { width: 390, height: 844 } })
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await mert.channelButton('genel').click()
    const sizes = await mert.page.evaluate(() => ({
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      htmlHeight: document.documentElement.getBoundingClientRect().height,
      innerHeight: window.innerHeight,
      safeArea: [...document.styleSheets].some((sheet) =>
        [...sheet.cssRules].some((rule) => rule.cssText.includes('safe-area-inset-bottom'))
      ),
    }))
    expect(sizes).toEqual({ colorScheme: 'dark', htmlHeight: 844, innerHeight: 844, safeArea: true })
    const composer = await mert.page.locator('.composer').boundingBox()
    expect(composer.y + composer.height).toBeLessThanOrEqual(844)
  })

  test('konuşan kişi kutucukta, kenar çubuğunda ve üye listesinde ışıklanıyor', async ({ disco }) => {
    // Sahte mikrofon yaklaşık saniyede bir kısa bip çalıyor, ışık da her bipte
    // yarım saniye kadar yanıyor. Saniyede bir yoklamak hep sessiz anlara denk
    // gelebildiği için her ekran karesinde bakılıyor.
    const lightsUp = (user, selector, name = '') =>
      user.page.waitForFunction(
        ({ selector, name }) =>
          [...document.querySelectorAll(selector)].some(
            (el) => el.classList.contains('is-speaking') && el.textContent.includes(name)
          ),
        { selector, name },
        { polling: 'raf', timeout: 15_000 }
      )
    const staysDark = (user, selector, name, ms) =>
      user.page.evaluate(
        async ({ selector, name, ms }) => {
          const end = performance.now() + ms
          while (performance.now() < end) {
            const lit = [...document.querySelectorAll(selector)].some(
              (el) => el.classList.contains('is-speaking') && el.textContent.includes(name)
            )
            if (lit) return false
            await new Promise(requestAnimationFrame)
          }
          return true
        },
        { selector, name, ms }
      )

    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()
    await mert.openChannel('genel')
    await mert.joinVoice()
    await expect(mert.peerTile('Ece')).toBeVisible()
    expect(await staysDark(mert, '.remote-video-wrapper', 'Ece', 1500)).toBe(true)

    await ece.micOn()
    await lightsUp(mert, '.remote-video-wrapper', 'Ece')
    await lightsUp(mert, '.channel-voicer', 'Ece')
    // Kendi mikrofonu açık olan da kendi kutucuğunda ışıklanıyor.
    await lightsUp(ece, '.tile--local')

    // Sağırlaştırınca da kimin konuştuğu görünmeye devam ediyor.
    await mert.mediaButton('Sağırlaştır (herkesi sustur)').click()
    await lightsUp(mert, '.remote-video-wrapper', 'Ece')

    // Mikrofonu kapatınca ışık sönüyor ve sönük kalıyor.
    await ece.mediaButton('Mikrofonu kapat').click()
    await mert.page.waitForTimeout(1000)
    expect(await staysDark(mert, '.remote-video-wrapper', 'Ece', 2500)).toBe(true)
  })

  test('mesajlar gün ayraçlarıyla ve aynı kişinin ardışık mesajları gruplu', async ({ disco }) => {
    // Saatler günün başına göre: test gece yarısından hemen sonra çalışsa da
    // "Dün" ve "Bugün" doğru kalsın.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const at = (minutes) => new Date(today.getTime() + minutes * 60_000)
    await insertChat(disco.mongoUri, disco.channels.genel, [
      { username: 'Ece', text: 'dünden kalma', at: at(-12 * 60) },
      { username: 'Ece', text: 'ilk mesaj', at: at(1) },
      { username: 'Ece', text: 'hemen ardından', at: at(3) },
      { username: 'Ece', text: 'çok sonra', at: at(11) },
      { username: 'Bora', text: 'başkası', at: at(12) },
    ])
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    await expect(mert.chat.locator('.chat-day-divider')).toHaveText(['Dün', 'Bugün'])
    const grouped = (text) => mert.chat.locator('.chat-message', { hasText: text })
    await expect(grouped('ilk mesaj')).not.toHaveClass(/chat-message--grouped/)
    await expect(grouped('hemen ardından')).toHaveClass(/chat-message--grouped/)
    await expect(grouped('çok sonra')).not.toHaveClass(/chat-message--grouped/)
    await expect(grouped('başkası')).not.toHaveClass(/chat-message--grouped/)
  })

  test('Shift+Enter yeni satır açıyor, Enter gönderiyor; satırlar karşıda korunuyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await mert.openChannel('genel')
    await ece.openChannel('genel')
    const input = mert.page.getByLabel('Mesaj yaz')
    await input.click()
    await mert.page.keyboard.type('birinci satır')
    await mert.page.keyboard.press('Shift+Enter')
    await mert.page.keyboard.type('ikinci satır')
    await mert.page.keyboard.press('Enter')
    await expect(input).toHaveValue('')
    const text = ece.chat.locator('.chat-message-text', { hasText: 'birinci satır' })
    await expect.poll(() => text.innerText()).toBe('birinci satır\nikinci satır')
  })

  test('emoji düğmesi emojiyi imlecin olduğu yere ekliyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const input = mert.page.getByLabel('Mesaj yaz')
    await input.fill('akşam gel')
    await input.evaluate((el) => el.setSelectionRange(6, 6))
    await mert.page.getByRole('button', { name: 'Emoji ekle' }).click()
    await mert.page.getByRole('menuitem', { name: '🔥' }).click()
    await expect(input).toHaveValue('akşam 🔥gel')
    await expect(input).toBeFocused()
  })

  test('sunucu sahibi kanalı pencereden oluşturuyor (masaüstünde prompt açılmıyordu)', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    await alganis.page.locator('.sidebar-server-button').click()
    await alganis.page.getByRole('menuitem', { name: 'Kanal oluştur' }).click()
    const dialog = alganis.page.getByRole('dialog', { name: 'Kanal oluştur' })
    await dialog.getByLabel('Kanal adı').fill('müzik')
    await dialog.getByRole('button', { name: 'Kanal oluştur', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(alganis.channelButton('müzik')).toBeVisible()
  })

  test('ayarlar tam ekran açılıyor, kategoriler arasında geziliyor, Esc kapatıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const opener = mert.page.getByRole('button', { name: 'Ayarlar', exact: true })
    await opener.click()
    const settings = mert.page.getByRole('dialog', { name: 'Ayarlar' })
    await expect(settings).toBeVisible()
    expect(await settings.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
    await settings.getByRole('button', { name: 'Görünüm' }).click()
    await settings.getByRole('radio', { name: 'Mavi' }).click()
    await expect(mert.page.locator('html')).toHaveAttribute('data-theme', 'mavi')
    await mert.page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})
