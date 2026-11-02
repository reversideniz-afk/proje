// Sunucular: oluşturma, silme, davetle katılma, kanal ve üye işlemleri,
// varlık listesi.
const crypto = require("crypto");
const { User, Message, ChannelMember, Server: ServerModel, ServerMember, ServerBan, Channel, Invite, Role } = require("../db");
const {
  isPlatformAdmin,
  getAccessibleServers,
  canAccessServer,
  isServerOwner,
  serverPermissions,
  requireServerPermission,
  channelViewer,
  canViewChannel,
} = require("../lib/access");
const { AVATAR_TYPES, avatarUrlsFor, serverIconUrl } = require("../lib/avatars");
const { io } = require("../lib/realtime");
const { TIMEOUT_MINUTES, TIMEOUT_MESSAGE, activeTimeout, isBanned } = require("../lib/moderation");
const { refreshUserServerRooms, recheckUserAccess, buildServerPresence, buildMemberList, announcePresence } = require("../lib/rooms");
const { serverRoomName, textRoomName, voiceRooms } = require("../lib/state");
const { unreadByChannel, unreadByServer } = require("../lib/unread");
const { isValidImageDataUri } = require("../lib/validate");
const {
  EXPIRY_HOURS,
  MAX_USES,
  newInviteCode,
  resolveInvite,
  consumeInvite,
  inviteSummary,
  serializeInvite,
} = require("../lib/invites");

module.exports = function registerServerHandlers(socket, ctx) {
  // ---- YENİ: Sunucu oluşturma — hesabı olan herkes kişi başı 1 tane
  // açabilir (spam'e karşı). Sunucuyu açan kişi otomatik olarak o
  // sunucunun sahibi/tek adminidir.
  socket.on("create-server", async ({ token, name }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    if (typeof name !== "string" || !name.trim() || name.trim().length > 50) {
      return callback({ success: false, message: "Sunucu adı 1-50 karakter olmalı." });
    }
    try {
      const existingOwned = await ServerModel.findOne({ ownerUsername: username }).lean();
      if (existingOwned) {
        return callback({
          success: false,
          message: "Zaten bir sunucun var — kişi başı yalnızca 1 sunucu açılabilir.",
        });
      }
      const server = await ServerModel.create({
        name: name.trim(),
        ownerUsername: username,
        inviteCode: crypto.randomBytes(9).toString("base64url"),
      });
      await ServerMember.create({ serverId: server._id, username, isOwner: true });
      await refreshUserServerRooms(username);
      callback({
        success: true,
        server: {
          id: server._id.toString(),
          name: server.name,
          isOwner: true,
          inviteCode: server.inviteCode,
        },
      });
    } catch (err) {
      console.error("Sunucu oluşturulurken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Sunucu silme — sadece sahibi ya da platform admini. ----
  socket.on("delete-server", async ({ token, serverId }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string") {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const server = await ServerModel.findById(serverId).lean();
      if (!server) return callback({ success: false, message: "Sunucu bulunamadı." });
      if (!(await isServerOwner(username, userRoles, server))) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const channels = await Channel.find({ serverId }).select("_id").lean();
      const channelIds = channels.map((c) => c._id);
      const members = await ServerMember.find({ serverId }).select("username").lean();
      await Message.deleteMany({ channelId: { $in: channelIds } });
      await ChannelMember.deleteMany({ channelId: { $in: channelIds } });
      await Channel.deleteMany({ serverId });
      await Role.deleteMany({ serverId });
      await Invite.deleteMany({ serverId });
      await ServerBan.deleteMany({ serverId });
      await ServerMember.deleteMany({ serverId });
      await ServerModel.deleteOne({ _id: serverId });
      callback({ success: true });
      // O an bu sunucunun kanallarında olanlar (sahibi dahil) çıkarılıyor.
      const affected = new Set([...members.map((m) => m.username), username]);
      for (const member of affected) {
        await recheckUserAccess(member, "Bu sunucu silindi.", { listChanged: true });
      }
    } catch (err) {
      console.error("Sunucu silinirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucuya davet koduyla katılma — hesap açma davetinden
  // (REGISTER_INVITE_CODE) TAMAMEN AYRI bir mekanizma: bu, zaten hesabı
  // olan birinin, arkadaşının sunucusuna katılması için.
  socket.on("join-server-by-invite", async ({ token, inviteCode }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const { server, invite, error } = await resolveInvite(inviteCode);
      if (error) return callback({ success: false, message: error });
      const existing = await ServerMember.findOne({ serverId: server._id, username }).lean();
      if (existing) {
        return callback({ success: false, message: "Bu sunucuya zaten üyesin." });
      }
      if (await isBanned(server._id, username)) {
        return callback({ success: false, message: "Bu sunucudan yasaklandın." });
      }
      if (!(await consumeInvite(invite))) {
        return callback({ success: false, message: "Bu davetin kullanım sınırı dolmuş." });
      }
      await ServerMember.create({ serverId: server._id, username, isOwner: false });
      await refreshUserServerRooms(username);
      // Sunucudaki herkesin üye listesi ve kişinin diğer cihazlarındaki sunucu listesi.
      io.to(serverRoomName(server._id.toString())).emit("members-changed", { serverId: server._id.toString() });
      io.to(`user:${username}`).emit("server-list-changed");
      callback({
        success: true,
        server: {
          id: server._id.toString(),
          name: server.name,
          isOwner: server.ownerUsername === username,
          iconUrl: serverIconUrl(server),
        },
      });
    } catch (err) {
      console.error("Sunucuya katılırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Davet bağlantısının hangi sunucuya ait olduğu: giriş yapmadan da
  // soruluyor (davet linkiyle gelen kişi giriş ekranında sunucu adını görsün).
  // Sadece ad ve üye sayısı gidiyor. ----
  socket.on("invite-info", async ({ code } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await resolveInvite(code);
      if (error) return callback({ success: false, message: error });
      callback({ success: true, server: await inviteSummary(server) });
    } catch (err) {
      console.error("Davet bilgisi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Davet oluşturabilenler (sahip ya da "Davet oluştur" rolü): yeni davet
  // (süre: 1, 24, 168 saat ya da null; kullanım: 0 sınırsız ya da 1, 5,
  // 10, 25), etkin davetlerin listesi, davet iptali.
  const ownedServer = async (username, serverId) => {
    if (!username || typeof serverId !== "string") return null;
    return (await requireServerPermission(username, serverId, "createInvites")).server || null;
  };

  socket.on("create-invite", async ({ serverId, expiresInHours = null, maxUses = 0 } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const server = await ownedServer(ctx.username, serverId);
      if (!server) return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      if (!(expiresInHours === null || EXPIRY_HOURS.includes(expiresInHours)) || !MAX_USES.includes(maxUses)) {
        return callback({ success: false, message: "Geçersiz davet ayarı." });
      }
      const invite = await Invite.create({
        code: newInviteCode(),
        serverId: server._id,
        createdBy: ctx.username,
        expiresAt: expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null,
        maxUses,
      });
      callback({ success: true, invite: serializeInvite(invite) });
    } catch (err) {
      console.error("Davet oluşturulurken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("list-invites", async ({ serverId } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const server = await ownedServer(ctx.username, serverId);
      if (!server) return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      const now = new Date();
      const invites = await Invite.find({
        serverId: server._id,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
        .sort({ createdAt: -1 })
        .lean();
      callback({
        success: true,
        invites: invites.filter((i) => !(i.maxUses > 0 && i.uses >= i.maxUses)).map(serializeInvite),
      });
    } catch (err) {
      console.error("Davetler alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("delete-invite", async ({ serverId, code } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const server = await ownedServer(ctx.username, serverId);
      if (!server || typeof code !== "string") {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      await Invite.deleteOne({ serverId: server._id, code });
      callback({ success: true });
    } catch (err) {
      console.error("Davet silinirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Kullanıcının erişebildiği sunucuların listesi (login/resume
  // sırasında zaten gönderiliyor — bu, ör. bir sunucu oluşturduktan/
  // katıldıktan sonra listeyi anlık tazelemek için). ----
  socket.on("list-my-servers", async ({ token }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const servers = await getAccessibleServers(username, userRoles);
      const unread = await unreadByServer(username, userRoles, servers);
      callback({
        success: true,
        servers: servers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === username,
          iconUrl: serverIconUrl(s),
          ...unread.get(s._id.toString()),
        })),
      });
    } catch (err) {
      console.error("Sunucu listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucunun davet kodunu getirme — sadece sahibi ya da
  // platform admini görebilir (paylaşılacak link/kod). ----
  socket.on("get-server-invite", async ({ token, serverId }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string") return callback({ success: false });
    try {
      const { server, error } = await requireServerPermission(username, serverId, "createInvites");
      if (error) return callback({ success: false, message: error });
      callback({ success: true, inviteCode: server.inviteCode });
    } catch (err) {
      console.error("Davet kodu alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucunun kanal listesi — aktif sunucu seçildiğinde
  // istemci bunu ayrıca istiyor (bkz. login/resume-session artık sadece
  // "myServers" döndürüyor, kanallar değil). ----
  socket.on("server-channels", async ({ token, serverId }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string") {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      if (!(await canAccessServer(username, userRoles, serverId))) {
        return callback({ success: false, message: "Bu sunucuya erişimin yok." });
      }
      const server = await ServerModel.findById(serverId).lean();
      const channels = await Channel.find({ serverId }).sort({ createdAt: 1 }).lean();
      const viewer = await channelViewer(username, userRoles, [server._id]);
      const accessible = channels.filter((c) => canViewChannel(viewer, c));
      const unread = await unreadByChannel(username, accessible.map((c) => c._id));
      callback({
        success: true,
        // Arayüz sadece yapabildiklerini göstersin (sunucu yine her
        // işlemde ayrıca denetliyor).
        permissions: await serverPermissions(username, userRoles, server),
        // Susturulduysa bitişi: yazma alanı o zamana kadar kapalı.
        timeoutUntil: await activeTimeout(server._id, username),
        channels: accessible.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          allowedRoleIds: (c.allowedRoleIds || []).map(String),
          legacyRoles: c.allowedRoles || [],
          ...(unread.get(c._id.toString()) || { unread: false, mentions: 0 }),
        })),
      });
    } catch (err) {
      console.error("Sunucu kanalları alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Bir sunucunun üyeleri: kim çevrimiçi, kim hangi kanalın sesinde ----
  socket.on("server-presence", async ({ token, serverId } = {}, callback) => {
    if (typeof callback !== "function") return;
    const username = await ctx.authenticate(token);
    if (!username || typeof serverId !== "string") {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    try {
      const requester = await User.findOne({ username }).select("roles").lean();
      if (!(await canAccessServer(username, requester?.roles || [], serverId))) {
        return callback({ success: false, message: "Bu sunucuya erişimin yok." });
      }
      callback({ success: true, members: await buildServerPresence(serverId) });
    } catch (err) {
      console.error("Sunucu varlık listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucuya kanal ekleme — sadece sahibi ya da platform
  // admini. v1'de yeni sunucularda kanal-başına rol kısıtlaması yok
  // (allowedRoles her zaman boş = sunucunun tüm üyelerine açık).
  socket.on("create-channel", async ({ token, serverId, name }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    if (typeof serverId !== "string" || typeof name !== "string") {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 50) {
      return callback({ success: false, message: "Kanal adı 1-50 karakter olmalı." });
    }
    try {
      const { error } = await requireServerPermission(username, serverId, "manageChannels");
      if (error) return callback({ success: false, message: error });
      const channel = await Channel.create({ serverId, name: trimmedName, allowedRoles: [] });
      // Yeni kanal sunucudaki herkesin listesine anında düşsün (H16).
      // Sunucudakiler yeni kanalın bildirim odasına da girsin.
      for (const id of io.sockets.adapter.rooms.get(serverRoomName(serverId)) || []) {
        await io.sockets.sockets.get(id)?.data.refreshServerRooms?.();
      }
      io.to(serverRoomName(serverId)).emit("channels-changed", { serverId });
      callback({ success: true, channel: { id: channel._id.toString(), name: channel.name } });
    } catch (err) {
      if (err.code === 11000) {
        return callback({ success: false, message: "Bu isimde bir kanal zaten var." });
      }
      console.error("Kanal oluşturulurken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Sunucunun adını değiştirme (sahibi): üyelerin listesi yenileniyor.
  socket.on("rename-server", async ({ serverId, name } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName || trimmedName.length > 50) {
      return reply({ success: false, message: "Sunucu adı 1-50 karakter olmalı." });
    }
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return reply({ success: false, message: error });
      await ServerModel.updateOne({ _id: server._id }, { name: trimmedName });
      io.to(serverRoomName(server._id.toString())).emit("server-list-changed");
      reply({ success: true, name: trimmedName });
    } catch (err) {
      console.error("Sunucu adı değiştirilirken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Sunucu simgesi (sahibi): profil fotoğrafıyla aynı kurallar (sadece
  // raster resim, data: adresi, ~500 KB). imageData null ise kaldırılıyor.
  socket.on("set-server-icon", async ({ serverId, imageData, mimeType } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    const removing = imageData === null;
    if (!removing && (!isValidImageDataUri(imageData, mimeType) || !AVATAR_TYPES.includes(mimeType))) {
      return reply({ success: false, message: "Sadece PNG, JPEG, GIF ya da WebP resim kullanılabilir." });
    }
    if (!removing && imageData.length > 700_000) {
      return reply({ success: false, message: "Simge çok büyük (en fazla ~500 KB)." });
    }
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return reply({ success: false, message: error });
      const update = removing ? { iconData: null, iconUpdatedAt: null } : { iconData: imageData, iconUpdatedAt: new Date() };
      await ServerModel.updateOne({ _id: server._id }, update);
      io.to(serverRoomName(server._id.toString())).emit("server-list-changed");
      reply({ success: true, iconUrl: serverIconUrl({ _id: server._id, ...update }) });
    } catch (err) {
      console.error("Sunucu simgesi kaydedilirken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucunun üye listesi — sadece sahibi ya da platform
  // admini görebilir (bugünkü platform-geneli "Üye Yönetimi"nden AYRI,
  // sadece BU sunucuya özel). ----
  socket.on("list-server-members", async ({ token, serverId }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string") return callback({ success: false });
    try {
      // Sahibin de bütün yetkileri var; "Üyeleri çıkar" listeyi görmeye yetiyor.
      const { error } = await requireServerPermission(username, serverId, "kickMembers");
      if (error) return callback({ success: false, message: error });
      const members = await ServerMember.find({ serverId }).sort({ joinedAt: 1 }).lean();
      const avatarUrls = await avatarUrlsFor(members.map((m) => m.username));
      callback({
        success: true,
        members: members.map((m) => ({
          username: m.username,
          isOwner: m.isOwner,
          roleIds: (m.roleIds || []).map(String),
          avatarUrl: avatarUrls.get(m.username) || null,
          timeoutUntil: m.timeoutUntil > new Date() ? m.timeoutUntil : null,
        })),
      });
    } catch (err) {
      console.error("Sunucu üyeleri alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucudan üye çıkarma (kick) — sadece sahibi ya da
  // platform admini; sunucu sahibi kendi kendini çıkaramaz (önce
  // "Sunucuyu Sil"i kullanmalı). ----
  socket.on("remove-server-member", async ({ token, serverId, targetUsername }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string" || typeof targetUsername !== "string") {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    try {
      const { server, error } = await requireServerPermission(username, serverId, "kickMembers");
      if (error) return callback({ success: false, message: error });
      if (targetUsername === server.ownerUsername) {
        return callback({ success: false, message: "Sunucu sahibi çıkarılamaz." });
      }
      await ServerMember.deleteOne({ serverId, username: targetUsername });
      callback({ success: true });
      await recheckUserAccess(targetUsername, "Bu sunucudan çıkarıldın.", { listChanged: true });
      io.to(serverRoomName(serverId)).emit("members-changed", { serverId });
    } catch (err) {
      console.error("Üye çıkarılırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Moderasyon ("Üyeleri yönet" yetkisi): yasaklama ve susturma. Sahip
  // ve kişinin kendisi hedef olamıyor; platform yöneticisi her sunucuyu
  // gördüğü için yasaklanamıyor (bkz. lib/moderation.js).
  const moderationTarget = async (serverId, target) => {
    if (typeof target !== "string" || !target) return { error: "Eksik bilgi." };
    const { server, error } = await requireServerPermission(ctx.username, serverId, "kickMembers");
    if (error) return { error };
    if (target === server.ownerUsername) return { error: "Sunucu sahibine bu yapılamaz." };
    if (target === ctx.username) return { error: "Bunu kendine yapamazsın." };
    const user = await User.findOne({ username: target }).select("roles").lean();
    if (!user) return { error: "Böyle bir kullanıcı yok." };
    if (isPlatformAdmin(user.roles)) return { error: "Platform yöneticisine bu yapılamaz." };
    return { server };
  };

  socket.on("ban-server-member", async ({ serverId, username: target } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    try {
      const { server, error } = await moderationTarget(serverId, target);
      if (error) return reply({ success: false, message: error });
      await ServerBan.updateOne(
        { serverId: server._id, username: target },
        { $setOnInsert: { bannedBy: ctx.username, createdAt: new Date() } },
        { upsert: true }
      );
      await ServerMember.deleteOne({ serverId: server._id, username: target });
      reply({ success: true });
      await recheckUserAccess(target, "Bu sunucudan yasaklandın.", { listChanged: true });
      io.to(serverRoomName(server._id.toString())).emit("members-changed", { serverId: server._id.toString() });
    } catch (err) {
      console.error("Üye yasaklanırken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("unban-server-member", async ({ serverId, username: target } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (typeof target !== "string") return reply({ success: false, message: "Eksik bilgi." });
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "kickMembers");
      if (error) return reply({ success: false, message: error });
      await ServerBan.deleteOne({ serverId: server._id, username: target });
      reply({ success: true });
    } catch (err) {
      console.error("Yasak kaldırılırken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("list-server-bans", async ({ serverId } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "kickMembers");
      if (error) return reply({ success: false, message: error });
      const bans = await ServerBan.find({ serverId: server._id }).sort({ createdAt: -1 }).lean();
      reply({
        success: true,
        bans: bans.map((b) => ({ username: b.username, bannedBy: b.bannedBy, createdAt: b.createdAt })),
      });
    } catch (err) {
      console.error("Yasaklılar alınırken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // minutes: TIMEOUT_MINUTES'ten biri; 0 susturmayı kaldırıyor. Susturulan
  // seste ise bu sunucunun sesinden çıkarılıyor; kendi cihazlarında yazma
  // alanı kapanıyor (timeout-changed).
  socket.on("timeout-server-member", async ({ serverId, username: target, minutes } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (minutes !== 0 && !TIMEOUT_MINUTES.includes(minutes)) return reply({ success: false, message: "Geçersiz süre." });
    try {
      const { server, error } = await moderationTarget(serverId, target);
      if (error) return reply({ success: false, message: error });
      const timeoutUntil = minutes ? new Date(Date.now() + minutes * 60_000) : null;
      const member = await ServerMember.findOneAndUpdate({ serverId: server._id, username: target }, { timeoutUntil });
      if (!member) return reply({ success: false, message: "Bu kişi sunucuda değil." });
      reply({ success: true, timeoutUntil });

      const id = server._id.toString();
      io.to(`user:${target}`).emit("timeout-changed", { serverId: id, timeoutUntil });
      if (timeoutUntil) {
        for (const [roomId, members] of Object.entries(voiceRooms)) {
          const sockets = Object.entries(members).filter(([, info]) => info.username === target && info.serverId === id);
          for (const [socketId] of sockets) io.sockets.sockets.get(socketId)?.data.endVoice(TIMEOUT_MESSAGE);
          if (sockets.length > 0) io.to(textRoomName(roomId)).emit("channel-members", await buildMemberList(roomId));
        }
        announcePresence([id]);
      }
      io.to(serverRoomName(id)).emit("members-changed", { serverId: id });
    } catch (err) {
      console.error("Üye susturulurken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
