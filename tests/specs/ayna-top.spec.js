// Ayna Top düzeni (2.3.0): alttaki gizlenen dock, sesteki herkesin
// toplandığı dans pisti, kanalın pist topu rengi ve hareketli sunucu simgesi.
import { test, expect } from '../harness/fixtures.js'

// 1x1 GIF ve PNG (sunucu simgesi için).
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')

async function openSettingsPage(user, label) {
  await user.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await user.page.getByRole('navigation', { name: 'Ayar kategorileri' }).getByRole('button', { name: label }).click()
}

// Dock ekranın altında mı (gizli) yoksa içinde mi?
const dockTop = (user) => user.page.locator('.dock').evaluate((el) => el.getBoundingClientRect().top)

test.describe('Ayna Top', { tag: '@ayna' }, () => {
  test('dock gizli başlıyor, imleç alt kenara gelince çıkıyor, uzaklaşınca iniyor; klavyeyle de açılıyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { viewport: { width: 1280, height: 800 } })
    await mert.openChannel('genel')
    const dock = mert.page.locator('.dock')

    await expect(dock).not.toHaveClass(/dock--shown/)
    await expect.poll(() => dockTop(mert)).toBeGreaterThanOrEqual(800)

    await mert.page.mouse.move(640, 798)
    await expect(dock).toHaveClass(/dock--shown/)
    await expect.poll(() => dockTop(mert)).toBeLessThan(800)
    // Alt kenarda beklerken açık kalıyor.
    await mert.page.waitForTimeout(900)
    await expect(dock).toHaveClass(/dock--shown/)

    // Sunucu simgesinin üstüne gelip uzaklaşınca kısa bir süre sonra iniyor.
    await mert.page.locator('.server-rail-icon[title="Test Sunucusu"]').hover()
    await mert.page.waitForTimeout(700)
    await expect(dock).toHaveClass(/dock--shown/)
    await mert.page.mouse.move(640, 300)
    await expect(dock).not.toHaveClass(/dock--shown/)
    await expect.poll(() => dockTop(mert)).toBeGreaterThanOrEqual(800)

    // Klavyeyle dock'a gelince açılıyor.
    await mert.page.locator('.server-rail-icon[title="Test Sunucusu"]').focus()
    await expect(dock).toHaveClass(/dock--shown/)

    // Telefonda dock yok, sunucular soldaki çekmecede.
    await mert.page.setViewportSize({ width: 390, height: 844 })
    await expect(mert.page.locator('.dock')).toHaveCount(0)
    await mert.page.getByRole('button', { name: 'Kanalları göster' }).click()
    await expect(mert.page.locator('.nav-drawer').getByRole('navigation', { name: 'Sunucular' })).toBeVisible()
  })

  test('pist: sesteki herkes topun etrafında, başka kanala bakarken de duruyor; seste değilken pistler kartından katılınıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    await ece.joinVoice()

    // Mert seste değil: pistler kartında genel dolu, oyun (baktığı kanal) boş.
    await mert.openChannel('oyun')
    const floors = mert.page.getByRole('region', { name: 'Pistler' })
    await expect(floors.getByRole('list', { name: 'genel sesinde' })).toContainText('Ece')
    await expect(floors).toContainText('boş')
    await floors.getByRole('button', { name: 'genel sesine katıl' }).click()

    await expect(mert.leaveVoiceButton()).toBeVisible()
    await expect(mert.channelTitle()).toHaveText('genel')
    await expect(mert.peerTile('Ece')).toBeVisible()
    await expect(mert.voicePanel().locator('.dancer--me')).toContainText('Sen')
    await expect(ece.peerTile('Mert')).toBeVisible()
    // Pist açıkken pistler kartı yok; kamera açılmadan görüntü sahnesi gizli.
    await expect(floors).toHaveCount(0)
    await expect(mert.page.locator('.video-stage')).toBeHidden()

    // Başka kanalın sohbetine bakarken de pist ve kontroller yerinde.
    await mert.openChannel('oyun')
    await expect(mert.voicePanel()).toContainText('genel')
    await expect(mert.peerTile('Ece')).toBeVisible()

    // Kamera açılınca sohbetin üstünde görüntü sahnesi çıkıyor.
    await ece.cameraOn()
    await expect(mert.cameraTile('Ece').locator('video')).toBeVisible()

    await mert.leaveVoiceButton().click()
    await expect(mert.voicePanel()).toHaveCount(0)
    await expect(ece.peerTile('Mert')).toHaveCount(0)
  })

  test('kanalın pist topu: hex kodu kaydediliyor, geçersiz kod reddediliyor, Otomatik ada dönüyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    await alganis.openChannel('genel')
    await alganis.channelButton('oyun').hover()
    await alganis.page.getByRole('button', { name: 'oyun kanalını düzenle' }).click()
    const dialog = alganis.page.getByRole('dialog', { name: '#oyun kanalı' })
    const hex = dialog.getByLabel('Hex kodu')

    await hex.fill('12345')
    await expect(dialog.getByText('#RRGGBB biçiminde yaz')).toBeVisible()
    await hex.fill('4cb8e8')
    await expect(dialog.getByText('#RRGGBB biçiminde yaz')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toHaveCount(0)

    // Seste olan herkes topu bu renkte görüyor.
    const ece = await disco.user('Ece')
    await ece.openChannel('oyun')
    await ece.joinVoice()
    await expect(ece.voicePanel().locator('.floor-card')).toHaveAttribute('style', /--ball-color: #4CB8E8/)
    await expect(alganis.page.getByRole('region', { name: 'Pistler' })).toContainText('oyun')

    // Sunucu geçersiz rengi kabul etmiyor.
    const client = await disco.client()
    await client.login('Alganis')
    const bad = await client.emitAck('update-channel', {
      serverId: disco.serverId,
      channelId: disco.channels.oyun,
      name: 'oyun',
      ballColor: 'kırmızı',
    })
    expect(bad).toEqual({ success: false, message: 'Top rengi #RRGGBB biçiminde olmalı.' })
    const list = await client.emitAck('server-channels', { token: client.token, serverId: disco.serverId })
    expect(list.channels.find((c) => c.name === 'oyun').ballColor).toBe('#4CB8E8')

    // Otomatik: renk kaldırılıyor, top kanal adından geliyor.
    await alganis.channelButton('oyun').hover()
    await alganis.page.getByRole('button', { name: 'oyun kanalını düzenle' }).click()
    await dialog.getByRole('button', { name: 'Otomatik' }).click()
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toHaveCount(0)
    await expect
      .poll(async () => (await client.emitAck('server-channels', { token: client.token, serverId: disco.serverId })).channels.find((c) => c.name === 'oyun').ballColor)
      .toBe(null)
    await expect(ece.voicePanel().locator('.floor-card')).not.toHaveAttribute('style', /#4CB8E8/)
  })

  test('GIF sunucu simgesi olduğu gibi kaydediliyor; dock\'ta durağan, üzerine gelince oynuyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    await alganis.openChannel('genel')
    await openSettingsPage(alganis, 'Sunucu ayarları')
    const settings = alganis.page.getByRole('dialog', { name: 'Ayarlar' })
    await settings.locator('input[type="file"]').setInputFiles({ name: 'simge.gif', mimeType: 'image/gif', buffer: TINY_GIF })
    await expect(settings.locator('.settings-server-icon img')).toBeVisible()
    await alganis.page.keyboard.press('Escape')

    const mert = await disco.user('Mert')
    await mert.openChannel('genel')
    const button = mert.page.getByRole('navigation', { name: 'Sunucular' }).getByRole('button', { name: 'Test Sunucusu' })
    const anim = button.locator('.server-icon-anim')
    await expect(anim).toHaveAttribute('src', /\/api\/server-icons\/.*a=1/)
    await expect(button.locator('canvas.server-icon-still')).toHaveCount(1)
    // GIF olduğu gibi duruyor (yeniden kodlanmadı).
    const response = await fetch(await anim.getAttribute('src'))
    const bytes = [response.headers.get('content-type'), (await response.arrayBuffer()).byteLength]
    expect(bytes).toEqual(['image/gif', TINY_GIF.length])

    await expect(anim).toHaveCSS('opacity', '0')
    await mert.showDock()
    await button.hover()
    await expect(anim).toHaveCSS('opacity', '1')
  })
})
