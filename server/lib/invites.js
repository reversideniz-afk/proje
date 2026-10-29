// Sunucu davetleri: sahibin oluşturduğu süreli ya da kullanım sayısı
// sınırlı bağlantılar (Invite) ve her sunucunun kalıcı davet kodu
// (Server.inviteCode, eskiden tek davet yolu buydu).
const crypto = require("crypto");
const { Invite, Server: ServerModel, ServerMember } = require("../db");

const EXPIRY_HOURS = [1, 24, 24 * 7]; // null: hiç dolmasın
const MAX_USES = [0, 1, 5, 10, 25]; // 0: sınırsız

function newInviteCode() {
  return crypto.randomBytes(6).toString("base64url");
}

// Kod -> { server, invite } ya da { error }. invite, kalıcı kodda null.
async function resolveInvite(code) {
  if (typeof code !== "string" || !code.trim()) return { error: "Davet kodu gerekli." };
  const trimmed = code.trim();
  const invite = await Invite.findOne({ code: trimmed }).lean();
  if (invite) {
    if (invite.expiresAt && invite.expiresAt <= new Date()) return { error: "Bu davetin süresi dolmuş." };
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      return { error: "Bu davetin kullanım sınırı dolmuş." };
    }
    const server = await ServerModel.findById(invite.serverId).lean();
    return server ? { server, invite } : { error: "Geçersiz davet kodu." };
  }
  const server = await ServerModel.findOne({ inviteCode: trimmed }).lean();
  return server ? { server, invite: null } : { error: "Geçersiz davet kodu." };
}

// Kullanım hakkını düşer; aynı anda iki kişi son hakkı alamasın diye koşul
// veritabanında kontrol ediliyor. Hak kalmadıysa false.
async function consumeInvite(invite) {
  if (!invite) return true;
  const filter = { _id: invite._id };
  if (invite.maxUses > 0) filter.uses = { $lt: invite.maxUses };
  return !!(await Invite.findOneAndUpdate(filter, { $inc: { uses: 1 } }));
}

async function inviteSummary(server) {
  const memberCount = await ServerMember.countDocuments({ serverId: server._id });
  return { id: server._id.toString(), name: server.name, memberCount };
}

function serializeInvite(invite) {
  return {
    code: invite.code,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt || null,
    maxUses: invite.maxUses,
    uses: invite.uses,
  };
}

module.exports = { EXPIRY_HOURS, MAX_USES, newInviteCode, resolveInvite, consumeInvite, inviteSummary, serializeInvite };
