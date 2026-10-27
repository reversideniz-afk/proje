// Sunucunun protokolündeki bütün olayların temel davranışı. Arayüz
// testlerinin dokunmadığı olayları (tepkiler, düzenleme, !sil komutları,
// eski mesajlar, profil fotoğrafı, yönetici işlemleri) da kapsıyor; sunucu
// kodunu yeniden düzenlerken bir şeyin bozulmadığını bunlar söylüyor.
import { test, expect } from '../harness/fixtures.js'
import { insertMessages } from '../harness/seed.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Kanala girmiş iki kişi ve Mert'in bir mesajı.
async function genelde(disco, names = ['Mert', 'Ece']) {
  const clients = {}
  for (const name of names) {
    clients[name] = await disco.client(name)
    await clients[name].joinChannel(disco.serverId, disco.channels.genel)
  }
  return clients
}

async function send(client, text) {
  const delivered = client.nextEvent('new-message', (m) => m.text === text)
  client.socket.emit('send-message', { token: client.token, text })
  return delivered
}

test.describe('Protokol', { tag: '@temel' }, () => {
  test('tepki ekleniyor ve aynı tepkiyle kaldırılıyor', async ({ disco }) => {
    const { Mert, Ece } = await genelde(disco)
    const message = await send(Mert, 'tepki ver')
    const added = Mert.nextEvent('reactions-updated')
    Ece.socket.emit('toggle-reaction', { token: Ece.token, messageId: message.id, emoji: '👍' })
    expect((await added).reactions).toEqual([{ emoji: '👍', username: 'Ece' }])
    const removed = Mert.nextEvent('reactions-updated')
    Ece.socket.emit('toggle-reaction', { token: Ece.token, messageId: message.id, emoji: '👍' })
    expect((await removed).reactions).toEqual([])
  })

  test('kendi mesajını düzenleyip silebiliyor, başkasınınkini değil', async ({ disco }) => {
    const { Mert, Ece } = await genelde(disco)
    const message = await send(Mert, 'ilk hâli')

    Ece.socket.emit('edit-message', { token: Ece.token, messageId: message.id, newText: 'Ece değiştirdi' })
    Ece.socket.emit('delete-message', { token: Ece.token, messageId: message.id })
    await sleep(500)
    expect(Mert.received('message-edited')).toEqual([])
    expect(Mert.received('messages-deleted')).toEqual([])

    const edited = Ece.nextEvent('message-edited')
    Mert.socket.emit('edit-message', { token: Mert.token, messageId: message.id, newText: 'son hâli' })
    expect(await edited).toMatchObject({ messageId: message.id, newText: 'son hâli' })
    const deleted = Ece.nextEvent('messages-deleted')
    Mert.socket.emit('delete-message', { token: Mert.token, messageId: message.id })
    expect(await deleted).toEqual({ messageIds: [message.id] })
  })

  test('!sil n kendi son mesajlarını siliyor', async ({ disco }) => {
    const { Mert, Ece } = await genelde(disco)
    for (const text of ['bir', 'iki', 'üç']) await send(Mert, text)
    const deleted = Ece.nextEvent('messages-deleted')
    const notice = Mert.nextEvent('new-message', (m) => m.system)
    Mert.socket.emit('delete-last-n', { token: Mert.token, n: 2 })
    expect((await deleted).messageIds).toHaveLength(2)
    expect((await notice).text).toBe('2 mesajın silindi.')
  })

  test('!sil @kullanıcı komutlarını sadece moderatör kullanabiliyor', async ({ disco }) => {
    const { Mert, Ece, Alganis } = await genelde(disco, ['Mert', 'Ece', 'Alganis'])
    for (const text of ['a', 'b', 'c']) await send(Mert, text)

    const refused = Ece.nextEvent('new-message', (m) => m.system)
    Ece.socket.emit('delete-user-last-n', { token: Ece.token, targetUsername: 'Mert', n: 1 })
    expect((await refused).text).toBe('Bu komutu kullanma yetkin yok.')

    const lastOne = Ece.nextEvent('messages-deleted')
    Alganis.socket.emit('delete-user-last-n', { token: Alganis.token, targetUsername: 'Mert', n: 1 })
    expect((await lastOne).messageIds).toHaveLength(1)
    const rest = Ece.nextEvent('messages-deleted')
    Alganis.socket.emit('delete-user-messages', { token: Alganis.token, targetUsername: 'Mert' })
    expect((await rest).messageIds).toHaveLength(2)
  })

  test('geçmiş 50 mesaj geliyor, eskileri parça parça yükleniyor', async ({ disco }) => {
    await insertMessages(disco.mongoUri, disco.channels.genel, 'Ece', 60)
    const mert = await disco.client('Mert')
    const history = mert.nextEvent('message-history')
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    const recent = await history
    expect(recent).toHaveLength(50)
    expect(recent[0].text).toBe('mesaj 11')
    const older = await mert.emitAck('load-older-messages', { token: mert.token, before: recent[0].createdAt })
    expect(older.messages.map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `mesaj ${i + 1}`))
  })

  test('yazıyor göstergesi kanaldaki diğerlerine gidiyor', async ({ disco }) => {
    const { Mert, Ece } = await genelde(disco)
    const typing = Ece.nextEvent('user-typing')
    Mert.socket.emit('typing-start', { token: Mert.token })
    expect(await typing).toEqual({ username: 'Mert' })
    const stopped = Ece.nextEvent('user-stopped-typing')
    Mert.socket.emit('typing-stop', { token: Mert.token })
    expect(await stopped).toEqual({ username: 'Mert' })
  })

  test('profil fotoğrafı kaydediliyor; dış adres ve büyük dosya reddediliyor', async ({ disco }) => {
    const { Mert } = await genelde(disco, ['Mert'])
    const saved = Mert.nextEvent('avatar-saved')
    Mert.socket.emit('set-avatar', { token: Mert.token, imageData: TINY_PNG, mimeType: 'image/png' })
    expect((await saved).avatarData).toBe(TINY_PNG)

    Mert.socket.emit('set-avatar', { token: Mert.token, imageData: 'https://ornek.invalid/x.png', mimeType: 'image/png' })
    const tooBig = Mert.nextEvent('new-message', (m) => m.system)
    const big = `data:image/png;base64,${'A'.repeat(800_000)}`
    Mert.socket.emit('set-avatar', { token: Mert.token, imageData: big, mimeType: 'image/png' })
    expect((await tooBig).text).toContain('çok büyük')
    expect(Mert.received('avatar-saved')).toHaveLength(1)
  })

  test('yönetici işlemleri: kullanıcı listesi, rol, kilit açma, IP banı', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    expect((await mert.emitAck('list-all-users', { token: mert.token })).success).toBe(false)
    const users = await alganis.emitAck('list-all-users', { token: alganis.token })
    expect(users.users.map((u) => u.username)).toEqual(['Alganis', 'Bora', 'Ece', 'Gozcu', 'Mert'])

    const roleAdded = alganis.nextEvent('user-role-updated')
    alganis.socket.emit('update-user-role', { token: alganis.token, targetUsername: 'Mert', role: 'VIP', action: 'add' })
    expect(await roleAdded).toEqual({ username: 'Mert', roles: ['VIP'] })

    const unlocked = alganis.nextEvent('user-login-unlocked')
    alganis.socket.emit('unlock-user-login', { token: alganis.token, targetUsername: 'Mert' })
    expect(await unlocked).toEqual({ username: 'Mert' })

    expect((await alganis.emitAck('list-banned-ips', { token: alganis.token })).bannedIps).toEqual([])
    const unbanned = alganis.nextEvent('ip-unbanned')
    alganis.socket.emit('unban-ip', { token: alganis.token, ip: '1.2.3.4' })
    expect(await unbanned).toEqual({ ip: '1.2.3.4' })
  })

  test('sunucu işlemleri: liste, davet kodu, üyeler, silme', async ({ disco }) => {
    const alganis = await disco.client('Alganis')
    const mert = await disco.client('Mert')
    const mine = await mert.emitAck('list-my-servers', { token: mert.token })
    expect(mine.servers).toEqual([{ id: disco.serverId, name: 'Test Sunucusu', isOwner: false }])

    expect((await mert.emitAck('get-server-invite', { token: mert.token, serverId: disco.serverId })).success).toBe(false)
    const invite = await alganis.emitAck('get-server-invite', { token: alganis.token, serverId: disco.serverId })
    expect(invite.inviteCode).toBe('sunucu-davet-test')

    const members = await alganis.emitAck('list-server-members', { token: alganis.token, serverId: disco.serverId })
    expect(members.members).toHaveLength(5)

    expect((await mert.emitAck('delete-server', { token: mert.token, serverId: disco.serverId })).success).toBe(false)
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    const listChanged = mert.nextEvent('server-list-changed')
    expect((await alganis.emitAck('delete-server', { token: alganis.token, serverId: disco.serverId })).success).toBe(true)
    await listChanged
    expect((await mert.emitAck('list-my-servers', { token: mert.token })).servers).toEqual([])
  })
})
