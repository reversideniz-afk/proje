// Telefonda kaydırarak çekmeceler: Discord'daki gibi sohbeti sağa kaydırınca
// kanal listesi, sola kaydırınca üye listesi açılıyor. Eskiden sadece
// başlıktaki düğmelerle açılıyordu (2.0.0'dan sonra kullanıcı istedi).
// Kaydırmalar tarayıcıya gerçek dokunma olayları olarak gidiyor.
import { test, expect } from '../harness/fixtures.js'
import { insertChat } from '../harness/seed.js'

const RIGHT = { from: { x: 40, y: 420 }, to: { x: 340, y: 430 } }
const LEFT = { from: { x: 340, y: 420 }, to: { x: 40, y: 430 } }

async function phoneInChannel(disco, name) {
  const user = await disco.user(name, { phone: true })
  await user.page.getByRole('button', { name: 'Kanalları göster' }).click()
  await user.channelButton('genel').click()
  await expect(user.channelTitle()).toHaveText('genel')
  return user
}

test.describe('Telefon: kaydırarak çekmeceler', { tag: '@faz5' }, () => {
  test('sağa kaydırınca kanal listesi, sola kaydırınca üye listesi açılıyor; ters yöne kaydırınca kapanıyor', async ({ disco }) => {
    const mert = await disco.user('Mert', { phone: true })
    const nav = mert.page.locator('.nav-drawer')
    const members = mert.page.locator('.member-drawer')

    await mert.swipe(RIGHT)
    await expect(nav).toHaveClass(/nav-drawer--open/)
    await mert.channelButton('genel').click()
    await expect(nav).not.toHaveClass(/nav-drawer--open/)
    await expect(mert.channelTitle()).toHaveText('genel')

    await mert.swipe(LEFT)
    await expect(members).toHaveClass(/member-drawer--open/)
    await expect(members.locator('.member-item--online', { hasText: 'Mert' })).toBeVisible()
    await mert.swipe({ from: { x: 150, y: 420 }, to: { x: 385, y: 430 } })
    await expect(members).not.toHaveClass(/member-drawer--open/)
    await expect(members).toBeHidden()

    await mert.swipe(RIGHT)
    await expect(nav).toHaveClass(/nav-drawer--open/)
    await mert.swipe({ from: { x: 300, y: 420 }, to: { x: 20, y: 430 } })
    await expect(nav).not.toHaveClass(/nav-drawer--open/)
    await expect(nav).toBeHidden()
  })

  test('çekmece parmağı takip ediyor; az kaydırıp bırakınca geri kapanıyor, hızlı kaydırınca açılıyor', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [{ username: 'Ece', text: 'kaydırma denemesi', minutesAgo: 1 }])
    const mert = await phoneInChannel(disco, 'Mert')
    const nav = mert.page.locator('.nav-drawer')
    const message = mert.chat.locator('.chat-message', { hasText: 'kaydırma denemesi' })
    const box = await message.boundingBox()
    const y = box.y + box.height / 2

    // Yavaşça 120 px (uzun basma süresinden uzun): çekmece parmakla geliyor,
    // mesajın uzun basma menüsü açılmıyor.
    await mert.swipe({ from: { x: 30, y }, to: { x: 150, y }, steps: 12, stepMs: 50, release: false })
    const dragged = await nav.boundingBox()
    expect(dragged.x + dragged.width).toBeCloseTo(120, -1)
    await expect(message).not.toHaveClass(/is-active/)

    // Yarıya varmadan bırakınca geri kapanıyor.
    await mert.liftFinger()
    await expect(nav).not.toHaveClass(/nav-drawer--open/)
    await expect(nav).toBeHidden()

    // Aynı mesafe hızlıca: açılıyor.
    await mert.swipe({ from: { x: 30, y }, to: { x: 150, y }, steps: 3 })
    await expect(nav).toHaveClass(/nav-drawer--open/)
  })

  test('dikey kaydırma ve yana kayan kod bloğu çekmeceyi açmıyor; seste kanal listesi açılıyor', async ({ disco }) => {
    const longLine = 'uzun_satir_'.repeat(30)
    await insertChat(disco.mongoUri, disco.channels.genel, [{ username: 'Ece', text: '```\n' + longLine + '\n```', minutesAgo: 1 }])
    const mert = await phoneInChannel(disco, 'Mert')
    const nav = mert.page.locator('.nav-drawer')
    const members = mert.page.locator('.member-drawer')

    // Kod bloğu kendisi kayıyor. (Önce bu: test sürücüsünün dokunuşlarında
    // dikey bir kaydırmadan hemen sonraki yatay hareket kaydırmaya
    // dönüşmüyor; uygulamayla ilgisi yok.)
    const code = mert.chat.locator('.md-codeblock')
    const box = await code.boundingBox()
    const y = box.y + box.height / 2
    await mert.swipe({ from: { x: box.x + box.width - 20, y }, to: { x: box.x + 20, y }, stepMs: 20 })
    await expect.poll(() => code.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)

    await mert.swipe({ from: { x: 200, y: 600 }, to: { x: 230, y: 300 }, stepMs: 20 })

    await expect(nav).not.toHaveClass(/nav-drawer--open/)
    await expect(members).not.toHaveClass(/member-drawer--open/)

    await mert.page.getByRole('button', { name: 'Sese katıl', exact: true }).click()
    await expect(mert.page.locator('.voice-stage')).toBeVisible()
    await mert.swipe(RIGHT)
    await expect(nav).toHaveClass(/nav-drawer--open/)
  })
})
