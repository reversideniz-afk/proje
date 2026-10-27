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
export const CHANNEL_NAMES = ['genel', 'oyun']
// Alganis platform yöneticisi ve sunucunun sahibi; Gozcu, testlerin
// sunucunun gözünden durumu izlediği gözlemci hesap.
export const USERS = {
  Alganis: { roles: ['Alganis'] },
  Mert: { roles: [] },
  Ece: { roles: [] },
  Bora: { roles: [] },
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
    for (const name of CHANNEL_NAMES) {
      const channel = await Channel.create({ serverId: server._id, name, allowedRoles: [] })
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

export function listSessionTokens(mongoUri) {
  return withDatabase(mongoUri, async () =>
    (await Session.find({}).select('token').lean()).map((s) => s.token)
  )
}
