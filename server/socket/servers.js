// Sunucular: oluşturma, silme, davetle katılma, kanal ve üye işlemleri,
// varlık listesi.
const crypto = require("crypto");
const { User, Message, ChannelMember, Server: ServerModel, ServerMember, Channel, Invite } = require("../db");
const { getAccessibleServers, canAccessServer, isServerOwner, userCanAccessChannelDoc } = require("../lib/access");
const { io } = require("../lib/realtime");
const { refreshUserServerRooms, recheckUserAccess, buildServerPresence } = require("../lib/rooms");
const { serverRoomName } = require("../lib/state");
const { unreadByChannel, unreadByServer } = require("../lib/unread");
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

  // Sahip için: yeni davet (süre: 1, 24, 168 saat ya da null; kullanım: 0
  // sınırsız ya da 1, 5, 10, 25), etkin davetlerin listesi, davet iptali.
  const ownedServer = async (username, serverId) => {
    if (!username || typeof serverId !== "string") return null;
    const requester = await User.findOne({ username }).lean();
    const server = await ServerModel.findById(serverId).lean().catch(() => null);
    if (!server || !(await isServerOwner(username, requester?.roles || [], server))) return null;
    return server;
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
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const server = await ServerModel.findById(serverId).lean();
      if (!server) return callback({ success: false, message: "Sunucu bulunamadı." });
      if (!(await isServerOwner(username, userRoles, server))) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
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
      const channels = await Channel.find({ serverId }).sort({ createdAt: 1 }).lean();
      const accessible = channels.filter((c) => userCanAccessChannelDoc(userRoles, c));
      const unread = await unreadByChannel(username, accessible.map((c) => c._id));
      callback({
        success: true,
        channels: accessible.map((c) => ({
          id: c._id.toString(),
          name: c.name,
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
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const server = await ServerModel.findById(serverId).lean();
      if (!server) return callback({ success: false, message: "Sunucu bulunamadı." });
      if (!(await isServerOwner(username, userRoles, server))) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
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

  // ---- YENİ: Bir sunucunun üye listesi — sadece sahibi ya da platform
  // admini görebilir (bugünkü platform-geneli "Üye Yönetimi"nden AYRI,
  // sadece BU sunucuya özel). ----
  socket.on("list-server-members", async ({ token, serverId }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username || typeof serverId !== "string") return callback({ success: false });
    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const server = await ServerModel.findById(serverId).lean();
      if (!server) return callback({ success: false, message: "Sunucu bulunamadı." });
      if (!(await isServerOwner(username, userRoles, server))) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const members = await ServerMember.find({ serverId }).sort({ joinedAt: 1 }).lean();
      callback({
        success: true,
        members: members.map((m) => ({ username: m.username, isOwner: m.isOwner })),
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
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const server = await ServerModel.findById(serverId).lean();
      if (!server) return callback({ success: false, message: "Sunucu bulunamadı." });
      if (!(await isServerOwner(username, userRoles, server))) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
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
};
