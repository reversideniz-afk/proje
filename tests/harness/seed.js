// Her testin başında boş bir veritabanına aynı örnek verileri yazıyoruz:
// beş kullanıcı, bir sunucu, iki kanal. Modeller doğrudan server/db.js'ten
// geliyor, yani şema sunucuyla hep aynı.
import { requireFromServer } from './paths.js'

const mongoose = requireFromServer('mongoose')
const bcrypt = requireFromServer('bcryptjs')
const { User, Server, ServerMember, Channel, Session } = requireFromServer('./db.js')

export const PASSWORD = 'test-sifre-1'
export const REGISTER_INVITE_CODE = 'kayit-davet-test'
export const SERVER_NAME = 'Test Sunucusu'
export const SERVER_INVITE_CODE = 'sunucu-davet-test'
// Kanal adı -> izinli roller (boş: sunucunun herkesine açık). 'ozel' sadece
// VIP rolündekilere açık; rol testleri için.
export const CHANNELS = { genel: [], oyun: [], ozel: ['VIP'] }
// Alganis platform yöneticisi ve sunucunun sahibi; Gozcu, testlerin
// sunucunun gözünden durumu izlediği gözlemci hesap.
export const USERS = {
  Alganis: { roles: ['Alganis'] },
  Mert: { roles: [] },
  Ece: { roles: ['VIP'] },
  Bora: { roles: ['VIP'] },
  Gozcu: { roles: [] },
}

export async function seedDatabase(mongoUri) {
  await mongoose.connect(mongoUri)
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 4)
    await User.insertMany(
      Object.entries(USERS).map(([username, { roles }]) => ({ username, passwordHash, roles }))
    )
    const server = await Server.create({
      name: SERVER_NAME,
      ownerUsername: 'Alganis',
      inviteCode: SERVER_INVITE_CODE,
    })
    await ServerMember.insertMany(
      Object.keys(USERS).map((username) => ({
        serverId: server._id,
        username,
        isOwner: username === 'Alganis',
      }))
    )
    const channels = {}
    for (const [name, allowedRoles] of Object.entries(CHANNELS)) {
      const channel = await Channel.create({ serverId: server._id, name, allowedRoles })
      channels[name] = channel._id.toString()
    }
    return { serverId: server._id.toString(), channels }
  } finally {
    await mongoose.disconnect()
  }
}

async function withDatabase(mongoUri, fn) {
  await mongoose.connect(mongoUri)
  try {
    return await fn()
  } finally {
    await mongoose.disconnect()
  }
}

// Canlı veritabanındaki eski "beni hatırla" kayıtlarının biçimi: anahtarın
// kendisi, özetlenmeden.
export function insertLegacySession(mongoUri, username, token) {
  return withDatabase(mongoUri, () =>
    Session.collection.insertOne({
      token,
      username,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
  )
}

// Bir kanala doğrudan veritabanından mesaj ekler (hız sınırına takılmadan
// uzun geçmiş oluşturmak için). En eskisi 'mesaj 1'.
export function insertMessages(mongoUri, channelId, username, count) {
  const { Message } = requireFromServer('./db.js')
  const start = Date.now() - count * 1000
  return withDatabase(mongoUri, () =>
    Message.insertMany(
      Array.from({ length: count }, (_, i) => ({
        channelId,
        username,
        text: `mesaj ${i + 1}`,
        createdAt: new Date(start + i * 1000),
      }))
    )
  )
}

export function listSessionTokens(mongoUri) {
  return withDatabase(mongoUri, async () =>
    (await Session.find({}).select('token').lean()).map((s) => s.token)
  )
}

// Gerçekçi bir sohbet geçmişi: [{ username, text, minutesAgo | at, reactions }].
export function insertChat(mongoUri, channelId, messages) {
  const { Message } = requireFromServer('./db.js')
  const now = Date.now()
  return withDatabase(mongoUri, () =>
    Message.insertMany(
      messages.map(({ username, text, minutesAgo, at, reactions = [], replyTo }) => ({
        channelId,
        username,
        text,
        reactions,
        replyTo,
        createdAt: at || new Date(now - minutesAgo * 60_000),
      }))
    )
  )
}
