// ============================================================
// SİNYALLEŞME SUNUCUSU (Signaling Server)
// ------------------------------------------------------------
// Bu sunucu SES/GÖRÜNTÜ VERİSİ TAŞIMIYOR. Sadece kullanıcıların
// birbirini bulmasını ve WebRTC bağlantı kurma mesajlarını
// (offer/answer/ice candidate) karşı tarafa iletmeyi sağlıyor.
// Gerçek ses/görüntü/ekran akışı, bağlantı kurulduktan sonra
// doğrudan cihazlar arasında (peer-to-peer) gidiyor.
//
// YENİ MİMARİ: Artık "metin kanalına girmek" ile "sese girmek" AYRI
// iki eylem. Biri metin kanalına girince sadece sohbeti/üye listesini
// görür, WebRTC bağlantısı HİÇ kurulmaz — "sese katıl" butonuna
// basınca ayrıca ses/görüntü bağlantıları kurulur.
// ============================================================

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const { connectDB, User, Message, ChannelMember } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Geliştirme aşamasında serbest; canlıya alırken kısıtlanabilir.
  },
});

const PORT = process.env.PORT || 3001;

// YENİ: Kanallar artık koda YAZILMIYOR — Render'ın Environment
// panelinden CHANNEL_1_NAME / CHANNEL_1_SECRET, CHANNEL_2_NAME /
// CHANNEL_2_SECRET ... şeklinde tanımlanıyor. İsim değiştirmek, kanal
// eklemek/çıkarmak artık SADECE bir ortam değişkeni işi — kod
// değişikliği ya da yeniden paketleme gerekmiyor.
function loadChannelsConfig() {
  const channels = [];
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`CHANNEL_${i}_NAME`];
    if (!name) continue;
    channels.push({ name, secret: process.env[`CHANNEL_${i}_SECRET`] || null });
  }
  return channels;
}
const CHANNELS_CONFIG = loadChannelsConfig();
if (CHANNELS_CONFIG.length === 0) {
  console.warn(
    "UYARI: Hiç kanal tanımlanmamış! Render'da CHANNEL_1_NAME, CHANNEL_1_SECRET vb. ekle."
  );
}
CHANNELS_CONFIG.forEach((c) => {
  if (!c.secret) {
    console.warn(`UYARI: "${c.name}" kanalı için şifre ayarlanmamış — şifresiz girilebilir!`);
  }
});

// Veritabanına bağlan (kişisel hesaplar için).
connectDB();

// YENİ (güvenlik): TURN sunucu bilgileri de koda/istemciye GÖMÜLMÜYOR —
// sadece giriş yapmış (doğrulanmış) kullanıcılara, login başarılı
// olduğunda gönderiliyor.
function buildIceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const { TURN_URL, TURN_USERNAME, TURN_CREDENTIAL } = process.env;
  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  return servers;
}
if (!process.env.TURN_URL || !process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) {
  console.warn(
    "UYARI: TURN_URL/TURN_USERNAME/TURN_CREDENTIAL ayarlanmamış — sadece STUN kullanılacak."
  );
}

app.get("/", (req, res) => {
  res.send("Sinyalleşme sunucusu çalışıyor. Bu bir web sayfası değil, sadece durum kontrolü.");
});

// ------------------------------------------------------------
// DURUM (bellekte tutuluyor)
// textRooms["Kanal"]  = { socketId: { username } }              — metin kanalında kim var
// voiceRooms["Kanal"] = { socketId: { username, muted, ... } }  — seste kim var (textRooms'un alt kümesi)
// ------------------------------------------------------------
const textRooms = {};
const voiceRooms = {};

const sessionTokens = new Map(); // token -> username

// YENİ (SADECE TEST İÇİN): Gerçek MongoDB'ye bağlanamadığım test
// ortamımda giriş akışını simüle edebilmek için. ALLOW_TEST_TOKENS
// Render'da HİÇBİR ZAMAN ayarlanmayacak — canlı sunucuda etkisiz.
function resolveUsername(token) {
  if (
    process.env.ALLOW_TEST_TOKENS === "true" &&
    typeof token === "string" &&
    token.startsWith("TEST_BYPASS:")
  ) {
    return token.slice("TEST_BYPASS:".length);
  }
  return sessionTokens.get(token);
}

function textRoomName(channel) {
  return `text:${channel}`;
}
function voiceRoomName(channel) {
  return `voice:${channel}`;
}

async function buildMemberList(channel) {
  const online = Object.values(textRooms[channel] || {}).map((u) => ({
    username: u.username,
    inVoice: Object.values(voiceRooms[channel] || {}).some((v) => v.username === u.username),
  }));
  const onlineUsernames = new Set(online.map((m) => m.username));

  let offline = [];
  try {
    const allMembers = await ChannelMember.find({ channel }).lean();
    offline = allMembers
      .filter((m) => !onlineUsernames.has(m.username))
      .map((m) => ({ username: m.username, lastSeenAt: m.lastSeenAt }));
  } catch (err) {
    console.error("Üye listesi alınırken hata:", err.message);
  }
  return { online, offline };
}

io.on("connection", (socket) => {
  let currentTextRoom = null;
  let currentVoiceRoom = null;

  // ---- Kişisel hesap girişi ----
  socket.on("login", async ({ username, password }, callback) => {
    if (!username || !password) {
      return callback({ success: false, message: "Kullanıcı adı ve şifre gerekli." });
    }
    try {
      const user = await User.findOne({ username: username.trim() });
      if (!user) {
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }
      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }
      const token = crypto.randomUUID();
      sessionTokens.set(token, user.username);
      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        channels: CHANNELS_CONFIG.map((c) => c.name),
      });
    } catch (err) {
      console.error("Giriş sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Metin kanalına katılma (SES BAĞLANTISI KURMAZ) ----
  socket.on("join-channel", async ({ roomId, token, secret }) => {
    const username = resolveUsername(token);
    if (!roomId || !username) {
      socket.emit("join-error", "Önce giriş yapman gerekiyor.");
      return;
    }
    const channelConfig = CHANNELS_CONFIG.find((c) => c.name === roomId);
    if (!channelConfig) {
      socket.emit("join-error", "Böyle bir kanal yok.");
      return;
    }
    if (channelConfig.secret && secret !== channelConfig.secret) {
      socket.emit("join-error", "Yanlış kanal şifresi.");
      return;
    }

    currentTextRoom = roomId;
    socket.join(textRoomName(roomId));
    if (!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.id] = { username };

    // Kalıcı üyelik kaydı (çevrimdışı listesinde görünebilmek için).
    try {
      await ChannelMember.findOneAndUpdate(
        { channel: roomId, username },
        { lastSeenAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error("Kanal üyeliği kaydedilirken hata:", err.message);
    }

    // Diğer metin-kanalı üyelerine bildir.
    socket.to(textRoomName(roomId)).emit("member-online", { username });

    // Üye listesi (online + offline) — hem yeni katılana hem herkese
    // güncel listeyi gönderiyoruz (basit ve tutarlı kalsın diye).
    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);

    // Mesaj geçmişi (sadece yeni katılana).
    try {
      const history = await Message.find({ channel: roomId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      socket.emit("message-history", history.reverse());
    } catch (err) {
      console.error("Mesaj geçmişi alınırken hata:", err.message);
    }
  });

  // ---- YENİ: Sese katılma (metin kanalına zaten girmiş olmalı) ----
  socket.on("join-voice", async ({ token }) => {
    const username = resolveUsername(token);
    const roomId = currentTextRoom;
    if (!username || !roomId) return;

    currentVoiceRoom = roomId;
    socket.join(voiceRoomName(roomId));
    if (!voiceRooms[roomId]) voiceRooms[roomId] = {};
    voiceRooms[roomId][socket.id] = {
      username,
      muted: true,
      cameraOn: false,
      sharingScreen: false,
    };

    const existingVoiceUsers = Object.entries(voiceRooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, ...info }));
    socket.emit("existing-voice-users", existingVoiceUsers);

    socket.to(voiceRoomName(roomId)).emit("voice-user-joined", {
      socketId: socket.id,
      ...voiceRooms[roomId][socket.id],
    });

    // Metin kanalındaki herkese GÜNCEL üye listesini gönder (kim seste,
    // kim değil bilgisi dahil) — istemci tarafında tek bir olayı
    // dinlemek yeterli olsun diye.
    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
  });

  // ---- YENİ: Sesten çıkma (metin kanalında kalmaya devam eder) ----
  socket.on("leave-voice", async () => {
    const roomId = currentVoiceRoom;
    if (!roomId) return;

    if (voiceRooms[roomId]) {
      delete voiceRooms[roomId][socket.id];
      if (Object.keys(voiceRooms[roomId]).length === 0) delete voiceRooms[roomId];
    }
    socket.to(voiceRoomName(roomId)).emit("voice-user-left", { socketId: socket.id });
    socket.leave(voiceRoomName(roomId));

    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
    currentVoiceRoom = null;
  });

  // ---- Sohbet mesajı gönderme (kalıcı) ----
  socket.on("send-message", async ({ token, text }) => {
    const username = resolveUsername(token);
    const trimmedText = (text || "").trim();
    if (!username || !currentTextRoom || !trimmedText) return;
    if (trimmedText.length > 2000) return;

    try {
      const message = await Message.create({
        channel: currentTextRoom,
        username,
        text: trimmedText,
      });
      io.to(textRoomName(currentTextRoom)).emit("new-message", {
        username: message.username,
        text: message.text,
        createdAt: message.createdAt,
      });
    } catch (err) {
      console.error("Mesaj kaydedilirken hata:", err.message);
    }
  });

  // ---- Daha eski mesajları getirme (geçmiş SINIRSIZ, parça parça) ----
  socket.on("load-older-messages", async ({ token, channel, before }, callback) => {
    const username = resolveUsername(token);
    if (!username || !channel) {
      if (typeof callback === "function") callback({ messages: [] });
      return;
    }
    try {
      const query = { channel };
      if (before) query.createdAt = { $lt: new Date(before) };
      const older = await Message.find(query).sort({ createdAt: -1 }).limit(50).lean();
      if (typeof callback === "function") callback({ messages: older.reverse() });
    } catch (err) {
      console.error("Eski mesajlar alınırken hata:", err.message);
      if (typeof callback === "function") callback({ messages: [] });
    }
  });

  // ---- WebRTC sinyal mesajlarını ilet (offer / answer / ice candidate) ----
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---- Mikrofon / kamera / ekran paylaşımı durum güncellemesi ----
  socket.on("state-update", (partialState) => {
    if (!currentVoiceRoom || !voiceRooms[currentVoiceRoom]?.[socket.id]) return;
    Object.assign(voiceRooms[currentVoiceRoom][socket.id], partialState);
    socket.to(voiceRoomName(currentVoiceRoom)).emit("user-state-update", {
      socketId: socket.id,
      state: partialState,
    });
  });

  // ---- Ayrılma (bağlantı tamamen kopunca) ----
  socket.on("disconnect", async () => {
    if (currentVoiceRoom) {
      const roomId = currentVoiceRoom;
      if (voiceRooms[roomId]) {
        delete voiceRooms[roomId][socket.id];
        if (Object.keys(voiceRooms[roomId]).length === 0) delete voiceRooms[roomId];
      }
      socket.to(voiceRoomName(roomId)).emit("voice-user-left", { socketId: socket.id });
    }
    if (currentTextRoom) {
      const roomId = currentTextRoom;
      const username = textRooms[roomId]?.[socket.id]?.username;
      if (textRooms[roomId]) {
        delete textRooms[roomId][socket.id];
        if (Object.keys(textRooms[roomId]).length === 0) delete textRooms[roomId];
      }
      if (username) {
        try {
          await ChannelMember.findOneAndUpdate(
            { channel: roomId, username },
            { lastSeenAt: new Date() }
          );
        } catch (err) {
          console.error("lastSeenAt güncellenirken hata:", err.message);
        }
        const memberList = await buildMemberList(roomId);
        io.to(textRoomName(roomId)).emit("channel-members", memberList);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor.`);
});
