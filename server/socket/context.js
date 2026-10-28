// Bağlantı (socket) başına durum ve yardımcılar: hangi kanal/ses açık,
// bağlantı kime ait, hız sınırı, erişimin yeniden kontrolü. Olay işleyicileri
// bu nesneyi (ctx) paylaşıyor.
const { User, ChannelMember } = require("../db");
const { getAccessibleServers, checkChannelAccess } = require("../lib/access");
const { createRateLimiter } = require("../lib/limits");
const { io } = require("../lib/realtime");
const { announcePresence, removeVoiceMember, buildMemberList } = require("../lib/rooms");
const { resolveUsername } = require("../lib/sessions");
const { socketsByUsername, textRooms, textRoomName, serverRoomName } = require("../lib/state");

function createConnectionContext(socket) {
  const ctx = {
    socket,
    textRoom: null,
    voiceRoom: null,
    // YENİ: şu an içinde bulunulan kanalın bağlı olduğu sunucu — mesaj
    // moderasyonu yetkisini (bkz. canModerateServer) her seferinde kanaldan
    // sunucuya geri gitmeden kontrol edebilmek için.
    serverId: null,
    // Bu bağlantının kime ait olduğu (el sıkışmada, girişte ya da eski
    // istemcilerde kanala girerken belirleniyor; bkz. bindUser).
    username: null,
  };

  // Erişebildiği sunucuların odalarına (server:<id>) katılır, artık
  // erişemediklerinden çıkar. Kanal ve üye değişiklikleri bu odalara
  // yayınlanıyor (H16).
  ctx.refreshServerRooms = async () => {
    const wanted = new Set();
    if (ctx.username) {
      try {
        const user = await User.findOne({ username: ctx.username }).select("roles").lean();
        const servers = await getAccessibleServers(ctx.username, user?.roles || []);
        servers.forEach((s) => wanted.add(serverRoomName(s._id.toString())));
      } catch (err) {
        console.error("Sunucu odaları alınırken hata:", err.message);
        return;
      }
    }
    for (const room of [...socket.rooms]) {
      if (room.startsWith("server:") && !wanted.has(room)) socket.leave(room);
    }
    wanted.forEach((room) => socket.join(room));
    socket.data.serverIds = [...wanted].map((room) => room.slice("server:".length));
  };

  socket.data.refreshServerRooms = ctx.refreshServerRooms;

  // Bağlantıyı bir kullanıcıya bağlar (ya da başka bir hesaba geçirir).
  ctx.bindUser = (username) => {
    if (ctx.username === username) return;
    if (ctx.username) {
      socketsByUsername.get(ctx.username)?.delete(socket);
      socket.leave(`user:${ctx.username}`);
    }
    ctx.username = username;
    socket.data.username = username;
    const wasOnline = socketsByUsername.has(username);
    if (!wasOnline) socketsByUsername.set(username, new Set());
    socketsByUsername.get(username).add(socket);
    socket.join(`user:${username}`);
    ctx.refreshServerRooms().then(() => {
      if (!wasOnline) announcePresence(socket.data.serverIds || []);
    });
  };

  // Olayı gönderenin kim olduğu: bağlantı bir kullanıcıya bağlıysa o, değilse
  // (eski istemciler) olayla gelen anahtardan.
  ctx.authenticate = async (token) => ctx.username ?? (await resolveUsername(token));

  // Bağlantıyı açık olan metin kanalından ve (varsa) sesten çıkarır; iki
  // kanala da güncel üye listesi gider.
  ctx.leaveChannels = async () => {
    const leftRooms = new Set();
    if (ctx.voiceRoom && removeVoiceMember(ctx.voiceRoom, socket.id)) {
      leftRooms.add(ctx.voiceRoom);
    }
    ctx.voiceRoom = null;
    if (ctx.textRoom) {
      socket.leave(textRoomName(ctx.textRoom));
      if (textRooms[ctx.textRoom]?.[socket.id]) {
        delete textRooms[ctx.textRoom][socket.id];
        if (Object.keys(textRooms[ctx.textRoom]).length === 0) delete textRooms[ctx.textRoom];
        leftRooms.add(ctx.textRoom);
      }
    }
    ctx.textRoom = null;
    ctx.serverId = null;
    for (const roomId of leftRooms) {
      if (ctx.username) {
        try {
          await ChannelMember.findOneAndUpdate(
            { channelId: roomId, username: ctx.username },
            { lastSeenAt: new Date() }
          );
        } catch (err) {
          console.error("lastSeenAt güncellenirken hata:", err.message);
        }
      }
      io.to(textRoomName(roomId)).emit("channel-members", await buildMemberList(roomId));
    }
  };

  // Çıkış yapınca: bağlantı açık kalıyor ama artık kimseye ait değil.
  ctx.unbindUser = async () => {
    await ctx.leaveChannels();
    if (!ctx.username) return;
    const sockets = socketsByUsername.get(ctx.username);
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) {
      socketsByUsername.delete(ctx.username);
      announcePresence(socket.data.serverIds || []);
    }
    for (const room of [...socket.rooms]) {
      if (room !== socket.id) socket.leave(room);
    }
    ctx.username = null;
    socket.data.username = null;
  };

  // Hız sınırı (bkz. RATE_LIMITS): sınırı aşan olay işlenmeden atılıyor.
  const rateLimit = createRateLimiter();

  let lastRateWarningAt = 0;

  socket.use(([event, ...args], next) => {
    const { allowed, group } = rateLimit(event);
    if (allowed) return next();
    const ack = args[args.length - 1];
    if (typeof ack === "function") ack({ success: false, message: "Çok hızlı gidiyorsun, biraz bekle." });
    if (group === "chat" && Date.now() - lastRateWarningAt > 5000) {
      lastRateWarningAt = Date.now();
      socket.emit("new-message", {
        username: "Sistem",
        system: true,
        text: "Çok hızlı mesaj gönderiyorsun, biraz yavaşla.",
        createdAt: new Date(),
      });
    }
  });

  // Bu bağlantının durumunu dışarıdan değiştirmek için (yukarıdaki
  // değişkenler bu kapsamda yaşıyor): başka bir yerden sese girilince ya
  // da erişim kalkınca çağrılıyor.
  // Sesi bitirir; bağlantı seste değilse null, öyleyse çıktığı kanalı döner.
  socket.data.endVoice = (message) => {
    if (!ctx.voiceRoom) return null;
    const roomId = ctx.voiceRoom;
    ctx.voiceRoom = null;
    removeVoiceMember(roomId, socket.id);
    socket.emit("voice-ended", { message });
    return roomId;
  };

  // Sunucudan atılınca, sunucu silinince ya da rolü değişince: erişimi
  // kalmayan kanaldan ve sesinden çıkarır, bildirim odalarını ayıklar.
  // Eskiden kişinin açık bağlantısı odada kalıyor, atıldıktan sonra da
  // okuyup yazmaya devam edebiliyordu (H7).
  socket.data.recheckAccess = async (message) => {
    if (!ctx.username) return;
    const changedRooms = new Set();
    if (ctx.voiceRoom && (await checkChannelAccess(ctx.username, ctx.voiceRoom)).error) {
      changedRooms.add(socket.data.endVoice(message));
    }
    if (ctx.textRoom && (await checkChannelAccess(ctx.username, ctx.textRoom)).error) {
      const roomId = ctx.textRoom;
      ctx.textRoom = null;
      ctx.serverId = null;
      socket.leave(textRoomName(roomId));
      if (textRooms[roomId]) {
        delete textRooms[roomId][socket.id];
        if (Object.keys(textRooms[roomId]).length === 0) delete textRooms[roomId];
      }
      changedRooms.add(roomId);
      socket.emit("join-error", message);
    }
    for (const room of [...socket.rooms]) {
      if (!room.startsWith("member-notify:")) continue;
      const channelId = room.slice("member-notify:".length);
      if ((await checkChannelAccess(ctx.username, channelId)).error) socket.leave(room);
    }
    for (const roomId of changedRooms) {
      io.to(textRoomName(roomId)).emit("channel-members", await buildMemberList(roomId));
    }
    await ctx.refreshServerRooms();
  };

  if (socket.data.username) ctx.bindUser(socket.data.username);

  return ctx;
}

module.exports = { createConnectionContext };
