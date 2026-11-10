// Kanal kategorileri ve sıralama: "Kanalları yönet" yetkisi olan kategori
// oluşturuyor, kanalları kategoriye koyuyor, kanalları ve kategorileri
// sürükleyerek taşıyor; herkes kategoriyi kendi ekranında daraltabiliyor.
// (2.1.0'dan sonra eklendi; kanallar oluşturulma sırasında duruyordu.)
import { test, expect } from '../harness/fixtures.js'

const category = (user, name) => user.page.getByRole('region', { name: `${name} kategorisi` })
const channelNames = (scope) => scope.locator('.channel-name').allTextContents()
const categoryOrder = (user) =>
  user.page.locator('section.channel-category').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
// Kategorisiz kanallar: ilk listedeki kanallar.
const topChannels = (user) => channelNames(user.page.locator('.channel-ribbon .channel-list').first())

test.describe('Kanal kategorileri', { tag: '@faz5' }, () => {
  test('kategori oluşturuluyor, kanal içine konuyor, sürükleyerek sıralanıyor; herkeste aynı', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    await alganis.openChannel('genel')
    await mert.openChannel('genel')
    const page = alganis.page

    await page.locator('.sidebar-server-button').click()
    await page.getByRole('menuitem', { name: 'Kategori oluştur' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kategori oluştur' })
    await dialog.getByLabel('Kategori adı').fill('Oyunlar')
    await dialog.getByRole('button', { name: 'Kategori oluştur' }).click()
    await expect(category(alganis, 'Oyunlar')).toBeVisible()
    // Boş kategori sadece yönetene görünüyor.
    await expect(category(mert, 'Oyunlar')).toHaveCount(0)

    // Kanal düzenleme penceresinden kategoriye (telefonda da böyle).
    await page.getByRole('button', { name: 'oyun kanalını düzenle' }).click()
    const edit = page.getByRole('dialog', { name: '#oyun kanalı' })
    await edit.getByLabel('Kategori').selectOption({ label: 'Oyunlar' })
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect.poll(() => channelNames(category(mert, 'Oyunlar'))).toEqual(['oyun'])
    await expect.poll(() => topChannels(mert)).toEqual(['genel'])

    // Kategoriye doğrudan kanal oluşturma: sona ekleniyor.
    await page.getByRole('button', { name: 'Oyunlar kategorisine kanal oluştur' }).click()
    const create = page.getByRole('dialog', { name: 'Kanal oluştur' })
    await create.getByLabel('Kanal adı').fill('turnuva')
    await create.getByRole('button', { name: 'Kanal oluştur', exact: true }).click()
    await expect.poll(() => channelNames(category(mert, 'Oyunlar'))).toEqual(['oyun', 'turnuva'])

    // Sürükle bırak: kanalın üstüne bırakılan onun önüne geçiyor; başlığa
    // bırakılan o kategorinin sonuna.
    await alganis.channelButton('turnuva').dragTo(alganis.channelButton('oyun'))
    await expect.poll(() => channelNames(category(mert, 'Oyunlar'))).toEqual(['turnuva', 'oyun'])
    await alganis.channelButton('genel').dragTo(category(alganis, 'Oyunlar').getByRole('button', { name: 'Oyunlar', exact: true }))
    await expect.poll(() => channelNames(category(mert, 'Oyunlar'))).toEqual(['turnuva', 'oyun', 'genel'])
    await expect.poll(() => topChannels(mert)).toEqual([])

    // Yetkisi olmayan taşıyamıyor.
    const ece = await disco.client('Ece')
    const channels = await ece.emitAck('server-channels', { serverId: disco.serverId })
    const genelId = channels.channels.find((c) => c.name === 'genel').id
    expect((await ece.emitAck('move-channel', { serverId: disco.serverId, channelId: genelId, categoryId: null })).message).toBe(
      'Bu işlemi yapma yetkin yok.'
    )
  })

  test('kategoriler sürükleyerek sıralanıyor, daraltılabiliyor; silinince kanalları üste geçiyor', async ({ disco }) => {
    const owner = await disco.client('Alganis')
    const sesli = await owner.emitAck('create-category', { serverId: disco.serverId, name: 'Sesli' })
    await owner.emitAck('create-category', { serverId: disco.serverId, name: 'Oyunlar' })
    await owner.emitAck('move-channel', { serverId: disco.serverId, channelId: disco.channels.oyun, categoryId: sesli.category.id })

    const alganis = await disco.user('Alganis')
    // Beni hatırla: sayfa yenilenince giriş ekranına düşmesin.
    const mert = await disco.user('Mert', { rememberMe: true })
    await alganis.openChannel('genel')
    await mert.openChannel('genel')
    await expect.poll(() => categoryOrder(alganis)).toEqual(['Sesli kategorisi', 'Oyunlar kategorisi'])

    await category(alganis, 'Oyunlar')
      .getByRole('button', { name: 'Oyunlar', exact: true })
      .dragTo(category(alganis, 'Sesli').getByRole('button', { name: 'Sesli', exact: true }))
    await expect.poll(() => categoryOrder(alganis)).toEqual(['Oyunlar kategorisi', 'Sesli kategorisi'])

    // Daraltma kişiye özel ve sayfa yenilense de kalıyor.
    const toggle = category(mert, 'Sesli').getByRole('button', { name: 'Sesli', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(mert.channelButton('oyun')).toHaveCount(0)
    await expect(alganis.channelButton('oyun')).toBeVisible()
    await mert.page.reload()
    await expect(category(mert, 'Sesli').getByRole('button', { name: 'Sesli', exact: true })).toHaveAttribute('aria-expanded', 'false')
    await expect(mert.channelButton('oyun')).toHaveCount(0)

    await alganis.page.getByRole('button', { name: 'Sesli kategorisini düzenle' }).click()
    const dialog = alganis.page.getByRole('dialog', { name: 'Sesli kategorisi' })
    await dialog.getByRole('button', { name: 'Kategoriyi sil' }).click()
    await dialog.getByRole('button', { name: 'Silmeyi onayla' }).click()
    await expect(category(alganis, 'Sesli')).toHaveCount(0)
    await expect.poll(() => topChannels(mert)).toEqual(['genel', 'oyun'])
  })
})
