// Kim neye erişebilir: platform yöneticisi, sunucu üyeliği, sunucu sahipliği,
// sunucuya özel rollerin yetkileri ve kanalların rol kısıtlamaları.
const { User, Server: ServerModel, ServerMember, Channel, Role } = require("../db");
const { PERMISSIONS } = require("./roles");

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
// Simgenin kendisi (iconData) listelere gitmiyor, sadece adresi.
async function getAccessibleServers(username, userRoles) {
  if (isPlatformAdmin(userRoles)) {
    return ServerModel.find({}).select("-iconData").sort({ createdAt: 1 }).lean();
  }
  const memberships = await ServerMember.find({ username }).select("serverId").lean();
  const serverIds = memberships.map((m) => m.serverId);
  if (serverIds.length === 0) return [];
  return ServerModel.find({ _id: { $in: serverIds } })
    .select("-iconData")
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

// Bir kişinin bir sunucudaki yetkileri. Sahip ve platform yöneticisi her
// şeyi yapabiliyor (isOwner: rolleri yönetme, sunucuyu silme); diğerleri
// rollerinin yetkilerinin birleşimi kadar.
async function serverPermissions(username, userRoles, server) {
  if (server.ownerUsername === username || isPlatformAdmin(userRoles)) {
    return { isOwner: true, ...Object.fromEntries(PERMISSIONS.map((p) => [p, true])) };
  }
  const member = await ServerMember.findOne({ serverId: server._id, username }).select("roleIds").lean();
  const roles = member?.roleIds?.length
    ? await Role.find({ _id: { $in: member.roleIds }, serverId: server._id }).select("permissions").lean()
    : [];
  return { isOwner: false, ...Object.fromEntries(PERMISSIONS.map((p) => [p, roles.some((r) => r.permissions?.[p])])) };
}

// Olay işleyicileri için: kişinin bu sunucuda bu yetkisi var mı?
// permission "isOwner" de olabilir. { server, permissions } ya da { error }.
async function requireServerPermission(username, serverId, permission) {
  try {
    const server = await ServerModel.findById(serverId).lean();
    if (!server) return { error: "Sunucu bulunamadı." };
    const user = await User.findOne({ username }).select("roles").lean();
    const permissions = await serverPermissions(username, user?.roles || [], server);
    if (!permissions[permission]) return { error: "Bu işlemi yapma yetkin yok." };
    return { server, permissions };
  } catch {
    // Geçersiz bir kimlik (ObjectId) de buraya düşer.
    return { error: "Sunucu bulunamadı." };
  }
}

// Başkasının mesajını silebilir mi (Mesajları yönet).
async function canModerateServer(username, userRoles, serverId) {
  if (isPlatformAdmin(userRoles)) return true;
  if (!serverId) return false;
  const server = await ServerModel.findById(serverId).select("ownerUsername").lean();
  if (!server) return false;
  return (await serverPermissions(username, userRoles, server)).manageMessages;
}

// Kanalları görme bilgisi: platform rolleri (eski kısıtlama) ve her
// sunucudaki rolleri ve sahipliği. Birçok kanal tek seferde süzülebilsin
// diye önceden toplanıyor; serverIds verilirse sadece o sunucular.
async function channelViewer(username, userRoles, serverIds) {
  const filter = serverIds ? { username, serverId: { $in: serverIds } } : { username };
  const memberships = await ServerMember.find(filter).select("serverId roleIds").lean();
  const owned = await ServerModel.find({ ownerUsername: username }).select("_id").lean();
  const ownedIds = new Set(owned.map((s) => s._id.toString()));
  return {
    userRoles,
    ownedIds,
    roleIdsByServer: new Map(memberships.map((m) => [m.serverId.toString(), (m.roleIds || []).map(String)])),
  };
}

// Kısıtlama yoksa herkese açık. Sahip kendi sunucusunun kanallarını her
// zaman görüyor. Eski kısıtlamada platform rolü, yenisinde sunucu rolü.
function canViewChannel(viewer, channel) {
  if (!channel) return false;
  const legacy = channel.allowedRoles || [];
  const roleIds = (channel.allowedRoleIds || []).map(String);
  if (legacy.length === 0 && roleIds.length === 0) return true;
  const serverId = channel.serverId.toString();
  if (viewer.ownedIds.has(serverId)) return true;
  if (legacy.some((role) => viewer.userRoles.includes(role))) return true;
  const memberRoleIds = viewer.roleIdsByServer.get(serverId) || [];
  return roleIds.some((id) => memberRoleIds.includes(id));
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
    // Özel mesaj: sadece iki taraf.
    if (channel.dmUsers?.length) {
      return channel.dmUsers.includes(username) ? { channel, roles } : { error: "Bu konuşmaya erişimin yok." };
    }
    if (!(await canAccessServer(username, roles, channel.serverId))) {
      return { error: "Bu sunucuya erişimin yok." };
    }
    const viewer = await channelViewer(username, roles, [channel.serverId]);
    if (!canViewChannel(viewer, channel)) return { error: "Bu kanala erişim yetkin yok." };
    return { channel, roles };
  } catch (err) {
    // Geçersiz bir kimlik (ObjectId) de buraya düşer.
    console.error("Kanal erişimi kontrol edilirken hata:", err.message);
    return { error: "Böyle bir kanal yok." };
  }
}

module.exports = {
  ADMIN_ROLE,
  isPlatformAdmin,
  getAccessibleServers,
  canAccessServer,
  isServerOwner,
  serverPermissions,
  requireServerPermission,
  canModerateServer,
  channelViewer,
  canViewChannel,
  checkChannelAccess,
};
