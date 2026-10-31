// Hesap ve sunucu ayarları: şifre değiştirme ve sunucunun adını değiştirme
// (2.0.0'dan sonra eklendi; ikisi de yoktu).
import { test, expect } from '../harness/fixtures.js'
import { PASSWORD } from '../harness/seed.js'

const NEW_PASSWORD = 'yeni-sifre-2'

async function openSettingsPage(user, label) {
  await user.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await user.page.getByRole('navigation', { name: 'Ayar kategorileri' }).getByRole('button', { name: label }).click()
}

test.describe('Hesap ve sunucu ayarları', { tag: '@faz5' }, () => {
  test('şifre değişince diğer cihaz giriş ekranına dönüyor, bu cihaz girişli kalıyor', async ({ disco }) => {
    const mert = await disco.user('Mert')
    const mertTelefon = await disco.user('Mert')
    await mert.openChannel('genel')
    await mertTelefon.openChannel('genel')

    await openSettingsPage(mert, 'Hesabım')
    const { page } = mert
    await page.getByLabel('Mevcut şifre').fill('yanlis-sifre')
    await page.getByLabel('Yeni şifre', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Yeni şifre (tekrar)').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Şifreyi değiştir' }).click()
    await expect(page.getByRole('alert')).toHaveText('Mevcut şifre yanlış.')

    await page.getByLabel('Mevcut şifre').fill(PASSWORD)
    await page.getByRole('button', { name: 'Şifreyi değiştir' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Şifren değiştirildi' })).toBeVisible()

    // Diğer cihaz: oturumu kapandı, nedeni giriş ekranında.
    await expect(mertTelefon.page.getByText('Şifren başka bir cihazda değiştirildi')).toBeVisible()
    await expect(mertTelefon.page.getByLabel('Kullanıcı adı')).toBeVisible()

    // Bu cihaz: bağlantı kopup gelince oturumu hâlâ geçerli (kanala geri
    // dönüyor), mesaj gidiyor.
    await page.keyboard.press('Escape')
    const observer = await disco.observer('genel')
    const mark = observer.mark()
    disco.dropConnections()
    const online = () => (observer.latestMembersSince(mark)?.online || []).map((m) => m.username)
    await expect.poll(() => observer.membersSince(mark).some((m) => !m.online.some((u) => u.username === 'Mert'))).toBe(true)
    await expect.poll(online, { timeout: 20_000 }).toContain('Mert')
    await mert.send('şifreden sonra da buradayım')
    await expect(mert.chat).toContainText('şifreden sonra da buradayım')

    const client = await disco.client()
    expect((await client.emitAck('login', { username: 'Mert', password: PASSWORD })).success).toBe(false)
    expect((await client.emitAck('login', { username: 'Mert', password: NEW_PASSWORD })).success).toBe(true)
  })

  test('sunucunun adını sahibi değiştiriyor, üyelerde de değişiyor; başkası değiştiremiyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    await alganis.openChannel('genel')
    await mert.openChannel('genel')

    await openSettingsPage(alganis, 'Sunucu ayarları')
    const nameInput = alganis.page.getByLabel('Ad', { exact: true })
    await nameInput.fill('Cuma Ekibi')
    await alganis.page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(alganis.page.getByText('Sunucunun adı değiştirildi.')).toBeVisible()

    const rail = mert.page.getByRole('navigation', { name: 'Sunucular' })
    await expect(rail.getByRole('button', { name: 'Cuma Ekibi' })).toBeVisible()

    const ece = await disco.client('Ece')
    const response = await ece.emitAck('rename-server', { serverId: disco.serverId, name: 'Ele geçirildi' })
    expect(response).toMatchObject({ success: false, message: 'Bu işlemi yapma yetkin yok.' })
    await expect(rail.getByRole('button', { name: 'Cuma Ekibi' })).toBeVisible()
  })
})
