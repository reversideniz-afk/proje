// Ses: sese katılma/çıkma, WebRTC sinyalleri ve mikrofon/kamera/ekran durumu.
const { Channel } = require("../db");
const { checkChannelAccess } = require("../lib/access");
const { emitToUsers } = require("../lib/friends");
const { SOUND_IDS, SOUND_COOLDOWN_MS } = require("../lib/soundboard");
const { avatarUrlOf } = require("../lib/avatars");
const { io } = require("../lib/realtime");
const { announcePresence, removeVoiceMember, buildMemberList } = require("../lib/rooms");
const { voiceRooms, textRoomName, voiceRoomName } = require("../lib/state");
const { pickVoiceState } = require("../lib/validate");

module.exports = function registerVoiceHandlers(socket, ctx) {
  // ---- Sese katılma ----
  // channelId verilmezse (eski istemciler) o an açık olan metin kanalının
  // sesine katılınıyor. Yeni istemci kanalı açıkça gönderiyor: yeniden
  // bağlanınca o sırada başka bir kanala bakıyor olsa bile sesin olduğu
  // kanala dönebilsin diye. state ile mikrofon/kamera/ekran durumu da
  // baştan doğru duyuruluyor.
  socket.on("join-voice", async ({ token, channelId, state } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const username = await ctx.authenticate(token);
    const roomId = typeof channelId === "string" ? channelId : ctx.textRoom;
    if (!username || !roomId) {
      reply({ success: false, message: "Önce bir kanala girmen gerekiyor." });
      return;
    }
    let voiceServerId = ctx.serverId;
    if (roomId !== ctx.textRoom) {
      const access = await checkChannelAccess(username, roomId);
      if (access.error) {
        reply({ success: false, message: access.error });
        return;
      }
      voiceServerId = access.channel.serverId ? access.channel.serverId.toString() : null;
    }

    // Profil fotoğrafının adresi de eş bilgisine ekleniyor: karşı taraf
    // kamerası kapalıyken baş harf yerine fotoğrafı görsün.
    let avatarUrl = null;
    try {
      avatarUrl = await avatarUrlOf(username);
    } catch (err) {
      console.error("Avatar alınırken hata:", err.message);
    }

    // Bir kişi aynı anda tek yerden seste olur. Aynı adla başka bir ses
    // kaydı varsa onu sesten çıkarıyoruz: ya internet koptuğu için geride
    // kalan ve sunucunun henüz fark etmediği eski bağlantıdır (yoksa kişi
    // seste iki kez görünürdü), ya da kişinin ikinci cihazıdır.
    const changedRooms = new Set([roomId]);
    for (const [otherRoomId, members] of Object.entries(voiceRooms)) {
      for (const [otherSocketId, info] of Object.entries(members)) {
        if (otherSocketId === socket.id || info.username !== username) continue;
        const otherSocket = io.sockets.sockets.get(otherSocketId);
        if (otherSocket) otherSocket.data.endVoice("Başka bir yerden sese bağlandın.");
        else removeVoiceMember(otherRoomId, otherSocketId);
        changedRooms.add(otherRoomId);
      }
    }
    if (ctx.voiceRoom && ctx.voiceRoom !== roomId) {
      removeVoiceMember(ctx.voiceRoom, socket.id);
      changedRooms.add(ctx.voiceRoom);
    }

    const alreadyInRoom = !!voiceRooms[roomId]?.[socket.id];
    ctx.voiceRoom = roomId;
    socket.join(voiceRoomName(roomId));
    if (!voiceRooms[roomId]) voiceRooms[roomId] = {};
    voiceRooms[roomId][socket.id] = {
      username,
      muted: true,
      cameraOn: false,
      sharingScreen: false,
      ...pickVoiceState(state),
      avatarUrl,
      serverId: voiceServerId,
    };
    if (voiceServerId) announcePresence([voiceServerId]);
    // Özel mesajda sese giren karşıdakini arıyor (karşıdaki seste değilse).
    if (!voiceServerId && !alreadyInRoom) {
      const channel = await Channel.findById(roomId).select("dmUsers").lean();
      const other = channel?.dmUsers?.find((u) => u !== username);
      if (other && !Object.values(voiceRooms[roomId]).some((info) => info.username === other)) {
        emitToUsers([other], "dm-call", { channelId: roomId, from: username });
      }
    }

    const existingVoiceUsers = Object.entries(voiceRooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, ...info }));
    socket.emit("existing-voice-users", existingVoiceUsers);

    if (!alreadyInRoom) {
      socket.to(voiceRoomName(roomId)).emit("voice-user-joined", {
        socketId: socket.id,
        ...voiceRooms[roomId][socket.id],
      });
    }

    // Metin kanalındaki herkese GÜNCEL üye listesini gönder (kim seste,
    // kim değil bilgisi dahil) — istemci tarafında tek bir olayı
    // dinlemek yeterli olsun diye.
    for (const changedRoomId of changedRooms) {
      const memberList = await buildMemberList(changedRoomId);
      io.to(textRoomName(changedRoomId)).emit("channel-members", memberList);
    }
    reply({ success: true });
  });

  // ---- Ses efektleri paneli: seste olan herkesin hoparlöründe çalıyor ----
  socket.on("play-sound", ({ soundId } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!ctx.username || !ctx.voiceRoom) return reply({ success: false, message: "Önce sese katıl." });
    if (!SOUND_IDS.includes(soundId)) return reply({ success: false, message: "Böyle bir ses yok." });
    const now = Date.now();
    if (now - (socket.data.lastSoundAt || 0) < SOUND_COOLDOWN_MS) {
      return reply({ success: false, message: "Biraz bekle." });
    }
    socket.data.lastSoundAt = now;
    io.to(voiceRoomName(ctx.voiceRoom)).emit("sound-played", { soundId, username: ctx.username });
    reply({ success: true });
  });

  // ---- YENİ: Sesten çıkma (metin kanalında kalmaya devam eder) ----
  socket.on("leave-voice", async () => {
    const roomId = ctx.voiceRoom;
    if (!roomId) return;
    ctx.voiceRoom = null;
    removeVoiceMember(roomId, socket.id);

    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
  });

  // ---- WebRTC sinyal mesajlarını ilet (offer / answer / ice candidate) ----
  socket.on("signal", ({ to, data }) => {
    // GÜVENLİK DÜZELTMESİ: Önceden bu, "to" olarak verilen HERHANGİ
    // bir socket kimliğine, hiç doğrulama yapmadan iletiliyordu. Bu,
    // giriş yapmış ama İLGİLİ ses odasında OLMAYAN birinin, başka bir
    // kişiye sahte bir WebRTC teklifi göndererek yetkisiz bir bağlantı
    // (izinsiz mikrofon/kamera erişimi) kurmaya çalışabileceği anlamına
    // geliyordu. Artık: hem gönderenin HEM hedefin, AYNI ses odasında
    // olduğunu doğruluyoruz — değilse, mesaj sessizce yok sayılıyor.
    if (typeof to !== "string" || !ctx.voiceRoom) return;
    // Gönderen de hâlâ odada olmalı (başka bir cihazdan sese girince bu
    // bağlantı odadan çıkarılmış olabilir, bkz. join-voice).
    if (!socket.rooms.has(voiceRoomName(ctx.voiceRoom))) return;
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket || !targetSocket.rooms.has(voiceRoomName(ctx.voiceRoom))) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---- Mikrofon / kamera / ekran paylaşımı durum güncellemesi ----
  // Sadece mikrofon/kamera/ekran alanları ve sadece true/false kabul
  // ediliyor. Eskiden gelen nesne olduğu gibi kayda kopyalanıyordu:
  // kurcalanmış bir istemci seste adını "Alganis" gösterebiliyor, avatar
  // alanına dış bir adres (takip pikseli) koyabiliyordu (H6).
  socket.on("state-update", (partialState) => {
    if (!ctx.voiceRoom || !voiceRooms[ctx.voiceRoom]?.[socket.id]) return;
    const state = pickVoiceState(partialState);
    if (Object.keys(state).length === 0) return;
    Object.assign(voiceRooms[ctx.voiceRoom][socket.id], state);
    socket.to(voiceRoomName(ctx.voiceRoom)).emit("user-state-update", {
      socketId: socket.id,
      state,
    });
  });
};
