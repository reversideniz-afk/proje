// Kim neye erişebilir: platform yöneticisi, sunucu üyeliği, sunucu sahipliği ve
// kanalların rol kısıtlamaları.
const { User, Server: ServerModel, ServerMember, Channel } = require("../db");

// YENİ: "!sil @kullanıcı" komutuyla BAŞKASININ mesajlarını topluca silme
// yetkisi, sadece rolleri arasında bu ismi taşıyan hesap(lar)a ait. Rol
// atamak için server/add-user.js ile o hesabın roles listesine
// "Alganis" eklenmesi yeterli — kod tarafında ayrıca bir "admin" alanı yok,
// mevcut serbest-metin rol sistemi (bkz. userCanAccessChannel) kullanılıyor.
const ADMIN_ROLE = "Alganis";

// YENİ: ÇOKLU SUNUCU — kanallar artık Render ortam değişkenlerinden değil,
// veritabanından (Server/ServerMember/Channel, bkz. db.js) geliyor. Her
// kullanıcı kendi sunucusunu açabiliyor (kişi başı 1 tane, bkz.
// "create-server"); ADMIN_ROLE ("Alganis") rolündeki platform admini ise
// HİÇBİR üyelik kaydına ihtiyaç duymadan her sunucuya otomatik erişir.
function isPlatformAdmin(userRoles) {
  return (userRoles || []).includes(ADMIN_ROLE);
}

// Kullanıcının erişebildiği TÜM sunucular — üye olduğu sunucular, ya da
// platform adminse (Alganis) hepsi.
async function getAccessibleServers(username, userRoles) {
  if (isPlatformAdmin(userRoles)) {
    return ServerModel.find({}).sort({ createdAt: 1 }).lean();
  }
  const memberships = await ServerMember.find({ username }).select("serverId").lean();
  const serverIds = memberships.map((m) => m.serverId);
  if (serverIds.length === 0) return [];
  return ServerModel.find({ _id: { $in: serverIds } })
    .sort({ createdAt: 1 })
    .lean();
}

async function canAccessServer(username, userRoles, serverId) {
  if (isPlatformAdmin(userRoles)) return true;
  const membership = await ServerMember.findOne({ serverId, username }).lean();
  return !!membership;
}

// Bir sunucunun "admini" — o sunucuyu açan kişi (bugünkü tek-global-admin
// deseninin sunucu bazına birebir yansıması), ya da platform admini.
async function isServerOwner(username, userRoles, server) {
  if (isPlatformAdmin(userRoles)) return true;
  return !!server && server.ownerUsername === username;
}

// Bir kanalın bağlı olduğu sunucuyu yöneten kişi mi diye bakan, sadece
// serverId'den yola çıkan kısayol (mesaj moderasyonu için — kanal
// nesnesini elimizde tutmadan tek sorguyla kontrol edelim diye).
async function canModerateServer(username, userRoles, serverId) {
  if (isPlatformAdmin(userRoles)) return true;
  if (!serverId) return false;
  const server = await ServerModel.findById(serverId).select("ownerUsername").lean();
  return server?.ownerUsername === username;
}

// Bir kullanıcının rollerinden en az biri, kanalın izinli rolleri
// arasında mı diye bakan ortak yardımcı fonksiyon (env yerine artık
// veritabanındaki Channel dokümanı üzerinden).
function userCanAccessChannelDoc(userRoles, channelDoc) {
  if (!channelDoc) return false;
  if (!channelDoc.allowedRoles || channelDoc.allowedRoles.length === 0) return true; // kısıtlama yok = herkese açık
  return channelDoc.allowedRoles.some((role) => userRoles.includes(role));
}

// Bir kullanıcının bir kanala (metin ya da ses) girme yetkisi var mı?
// serverId verilirse kanalın o sunucuya ait olduğu da doğrulanıyor.
// Başarılıysa { channel, roles }, değilse { error } döner.
async function checkChannelAccess(username, channelId, serverId) {
  try {
    const user = await User.findOne({ username }).select("roles").lean();
    const roles = user?.roles || [];
    const channel = await Channel.findOne(
      serverId ? { _id: channelId, serverId } : { _id: channelId }
    ).lean();
    if (!channel) return { error: "Böyle bir kanal yok." };
    if (!(await canAccessServer(username, roles, channel.serverId))) {
      return { error: "Bu sunucuya erişimin yok." };
    }
    if (!userCanAccessChannelDoc(roles, channel)) return { error: "Bu kanala erişim yetkin yok." };
    return { channel, roles };
  } catch (err) {
    // Geçersiz bir kimlik (ObjectId) de buraya düşer.
    console.error("Kanal erişimi kontrol edilirken hata:", err.message);
    return { error: "Böyle bir kanal yok." };
  }
}

module.exports = { ADMIN_ROLE, isPlatformAdmin, getAccessibleServers, canAccessServer, isServerOwner, canModerateServer, userCanAccessChannelDoc, checkChannelAccess };
