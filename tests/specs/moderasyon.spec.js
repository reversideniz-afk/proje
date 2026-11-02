// Moderasyon: yasaklama ve susturma (Ayarlar > Üyeler, "Üyeleri yönet"
// yetkisi). 2.1.0'dan sonra eklendi; eskiden sadece çıkarma vardı ve
// çıkarılan davetle hemen geri gelebiliyordu.
import { test, expect } from '../harness/fixtures.js'
import { SERVER_INVITE_CODE } from '../harness/seed.js'

async function openMembersSettings(user) {
  await user.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await user.page.getByRole('navigation', { name: 'Ayar kategorileri' }).getByRole('button', { name: 'Üyeler' }).click()
  return user.page.getByRole('dialog', { name: 'Ayarlar' })
}

const memberRow = (settings, name) =>
  settings.getByRole('list', { name: 'Sunucu üyeleri' }).getByRole('listitem').filter({ hasText: name })

test.describe('Moderasyon', { tag: '@faz5' }, () => {
  test('yasaklanan çıkarılıyor ve davetle geri giremiyor; yasak kalkınca girebiliyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    await alganis.openChannel('genel')
    await mert.openChannel('genel')

    const settings = await openMembersSettings(alganis)
    await memberRow(settings, 'Mert').getByRole('button', { name: 'Yasakla' }).click()
    await settings.getByRole('group', { name: 'Mert: yasaklama onayı' }).getByRole('button', { name: 'Evet, yasakla' }).click()
    await expect(memberRow(settings, 'Mert')).toHaveCount(0)
    const bans = settings.getByRole('list', { name: 'Yasaklananlar' })
    await expect(bans).toContainText('Mert')

    // Mert sunucudan çıkarıldı; ne sabit kodla ne davet bağlantısıyla dönebiliyor.
    await expect(mert.page.getByText('Bu sunucudan yasaklandın.')).toBeVisible()
    await expect(mert.page.getByRole('navigation', { name: 'Sunucular' }).getByRole('button', { name: 'Test Sunucusu' })).toHaveCount(0)
    const mertClient = await disco.client('Mert')
    expect(await mertClient.emitAck('join-server-by-invite', { inviteCode: SERVER_INVITE_CODE })).toMatchObject({
      success: false,
      message: 'Bu sunucudan yasaklandın.',
    })
    const owner = await disco.client('Alganis')
    const invite = await owner.emitAck('create-invite', { serverId: disco.serverId, expiresInHours: 24, maxUses: 0 })
    expect((await mertClient.emitAck('join-server-by-invite', { inviteCode: invite.invite.code })).success).toBe(false)

    // Yetkisi olmayan yasaklayamıyor; sahip yasaklanamıyor.
    const ece = await disco.client('Ece')
    expect((await ece.emitAck('ban-server-member', { serverId: disco.serverId, username: 'Bora' })).message).toBe(
      'Bu işlemi yapma yetkin yok.'
    )

    await bans.getByRole('button', { name: 'Yasağı kaldır' }).click()
    await expect(bans).toHaveCount(0)
    expect((await mertClient.emitAck('join-server-by-invite', { inviteCode: SERVER_INVITE_CODE })).success).toBe(true)
  })

  test('susturulan yazamıyor ve sese giremiyor, seste ise çıkarılıyor; kaldırılınca yazabiliyor', async ({ disco }) => {
    const alganis = await disco.user('Alganis')
    const mert = await disco.user('Mert')
    await alganis.openChannel('genel')
    await mert.openChannel('genel')
    await mert.joinVoice()

    const settings = await openMembersSettings(alganis)
    await memberRow(settings, 'Mert').getByRole('combobox', { name: 'Mert: sustur' }).selectOption({ label: '5 dakika' })
    await expect(memberRow(settings, 'Mert')).toContainText('Susturuldu')

    // Mert: sesten çıkarıldı (nedeni uyarı şeridinde), yazma alanının
    // yerinde ne zaman yazabileceği.
    await expect(mert.leaveVoiceButton()).toHaveCount(0)
    await expect(mert.page.getByText('süre bitene kadar yazamaz ve sese giremezsin')).toBeVisible()
    await expect(mert.page.locator('.composer--locked')).toContainText(/susturuldun: \d+ dakika sonra yeniden yazabilirsin/)
    await expect(mert.page.getByLabel('Mesaj yaz')).toHaveCount(0)
    await expect(mert.page.getByRole('button', { name: 'Sese katıl', exact: true })).toHaveCount(0)

    // Sunucu da izin vermiyor (arayüz dışından gelen istekler).
    const mertClient = await disco.client('Mert')
    await mertClient.joinChannel(disco.serverId, disco.channels.genel)
    const observer = await disco.observer('genel')
    const mark = observer.mark()
    const notice = mertClient.nextEvent('new-message')
    mertClient.socket.emit('send-message', { token: mertClient.token, text: 'susturulmuşken' })
    expect(await notice).toMatchObject({ username: 'Sistem', text: expect.stringContaining('susturuldun') })
    expect((await mertClient.emitAck('join-voice', { token: mertClient.token, channelId: disco.channels.genel })).success).toBe(false)
    expect((await mertClient.emitAck('create-poll', { question: 'Ne?', options: ['a', 'b'] })).success).toBe(false)
    expect(observer.events.slice(mark).some((e) => e.event === 'new-message')).toBe(false)

    expect((await mertClient.emitAck('timeout-server-member', { serverId: disco.serverId, username: 'Bora', minutes: 5 })).success).toBe(false)
    const owner = await disco.client('Alganis')
    expect((await owner.emitAck('timeout-server-member', { serverId: disco.serverId, username: 'Bora', minutes: 7 })).message).toBe('Geçersiz süre.')

    await memberRow(settings, 'Mert').getByRole('button', { name: 'Susturmayı kaldır' }).click()
    await expect(mert.page.getByLabel('Mesaj yaz')).toBeVisible()
    await mert.send('yeniden buradayım')
    await expect(alganis.chat).toContainText('yeniden buradayım')
  })
})
