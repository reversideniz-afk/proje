// Faz 5: Discord'a yaklaşan özellikler ve bu fazda kapanan hatalar (H28).
import { test, expect } from '../harness/fixtures.js'

const micTracks = (user) =>
  user.probe(() =>
    window.__disco.mediaTracks
      .filter((t) => t.kind === 'audio')
      .map((t) => ({ enabled: t.enabled, live: t.readyState === 'live' }))
  )

test.describe('Faz 5: özellikler', { tag: '@faz5' }, () => {
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
