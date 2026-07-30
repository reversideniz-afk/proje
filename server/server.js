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

// YENİ (sağlamlık): Kodda gözden kaçan bir hata olsa bile (ör. beklenmedik
// bir veri tipi), sunucunun TÜMDEN çökmesini istemiyoruz — herkesin
// bağlantısı bir kişinin hatası yüzünden kesilmesin. Hatayı loglayıp
// sunucuyu ayakta tutuyoruz.
process.on("uncaughtException", (err) => {
  console.error("YAKALANMAMIŞ HATA (sunucu ayakta kalıyor):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("YAKALANMAMIŞ PROMISE HATASI (sunucu ayakta kalıyor):", reason);
});
const { connectDB, User, Message, ChannelMember } = require("./db");

// YENİ: "!sil @kullanıcı" komutuyla BAŞKASININ mesajlarını topluca silme
// yetkisi, sadece rolleri arasında bu ismi taşıyan hesap(lar)a ait. Rol
// atamak için server/add-user.js ile o hesabın roles listesine
// "Alganis" eklenmesi yeterli — kod tarafında ayrıca bir "admin" alanı yok,
// mevcut serbest-metin rol sistemi (bkz. userCanAccessChannel) kullanılıyor.
const ADMIN_ROLE = "Alganis";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Geliştirme aşamasında serbest; canlıya alırken kısıtlanabilir.
  },
  // YENİ: Varsayılan limit (1 MB) fotoğraf göndermek için çok düşük.
  // 10 MB'lık bir fotoğraf base64'e çevrilince ~%33 büyüyor, üstüne
  // biraz da pay bırakıyoruz.
  maxHttpBufferSize: 15 * 1024 * 1024,
});

const PORT = process.env.PORT || 3001;

// YENİ: Kanallar artık ŞİFRE ile değil, ROL (etiket) ile korunuyor —
// Discord'daki rol mantığı gibi. Render'ın Environment panelinden
// CHANNEL_1_NAME / CHANNEL_1_ROLES (virgülle ayrılmış, ör.
// "Yönetici,Arkadaş") şeklinde tanımlanıyor. Bir kanalın CHANNEL_N_ROLES
// alanı BOŞSA, o kanal HERKESE açık demektir (bilerek — bir kanalı
// yanlışlıkla erişilemez bırakmamak için).
function loadChannelsConfig() {
  const channels = [];
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`CHANNEL_${i}_NAME`];
    if (!name) continue;
    const rolesRaw = process.env[`CHANNEL_${i}_ROLES`] || "";
    const allowedRoles = rolesRaw
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    channels.push({ name, allowedRoles });
  }
  return channels;
}
const CHANNELS_CONFIG = loadChannelsConfig();
if (CHANNELS_CONFIG.length === 0) {
  console.warn(
    "UYARI: Hiç kanal tanımlanmamış! Render'da CHANNEL_1_NAME, CHANNEL_1_ROLES vb. ekle."
  );
}
CHANNELS_CONFIG.forEach((c) => {
  if (c.allowedRoles.length === 0) {
    console.warn(`UYARI: "${c.name}" kanalı için rol kısıtlaması yok — HERKESE açık!`);
  }
});

// Bir kullanıcının rollerinden en az biri, kanalın izinli rolleri
// arasında mı diye bakan ortak yardımcı fonksiyon.
function userCanAccessChannel(userRoles, channelConfig) {
  if (!channelConfig) return false;
  if (channelConfig.allowedRoles.length === 0) return true; // kısıtlama yok = herkese açık
  return channelConfig.allowedRoles.some((role) => userRoles.includes(role));
}

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

// YENİ (güvenlik): "imageData" alanının GERÇEKTEN bir base64 data URI
// olduğunu ve beyan edilen mimeType ile eşleştiğini doğruluyoruz. Bu
// kontrol olmadan biri imageData alanına dışarıdan bir URL (ör.
// "http://saldirgan.com/piksel.png") koyabilir — bunu gören HERKESİN
// istemcisi (<img src=...>) o adrese sessizce bir istek atar, bu da
// görüntüleyen kullanıcıların IP adresini/varlık bilgisini saldırgana
// sızdırır ("takip pikseli"). set-avatar VE send-photo aynı deseni
// kullandığı için ortak fonksiyon.
function isValidImageDataUri(imageData, mimeType) {
  if (typeof imageData !== "string" || typeof mimeType !== "string") return false;
  if (!mimeType.startsWith("image/")) return false;
  const match = imageData.match(
    /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/
  );
  return !!match && match[1] === mimeType;
}

function textRoomName(channel) {
  return `text:${channel}`;
}
function voiceRoomName(channel) {
  return `voice:${channel}`;
}

// YENİ: .lean() sorgu sonuçlarını istemciye göndereceğimiz tutarlı
// şekle çeviriyor (_id -> id, string olarak).
function serializeMessage(msg) {
  return {
    id: msg._id.toString(),
    username: msg.username,
    text: msg.text,
    createdAt: msg.createdAt,
    editedAt: msg.editedAt || null,
    reactions: msg.reactions || [],
  };
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

  // YENİ: profil fotoğraflarını TEK sorguda çekip her iki listeye de
  // ekliyoruz — online üyeler için textRooms (bellek içi) hiç avatar
  // tutmuyor, o yüzden veritabanından tamamlıyoruz.
  try {
    const allUsernames = [...onlineUsernames, ...offline.map((m) => m.username)];
    if (allUsernames.length > 0) {
      const users = await User.find({ username: { $in: allUsernames } })
        .select("username avatarData")
        .lean();
      const avatarByUsername = new Map(users.map((u) => [u.username, u.avatarData || null]));
      online.forEach((m) => {
        m.avatarData = avatarByUsername.get(m.username) || null;
      });
      offline.forEach((m) => {
        m.avatarData = avatarByUsername.get(m.username) || null;
      });
    }
  } catch (err) {
    console.error("Profil fotoğrafları alınırken hata:", err.message);
  }

  return { online, offline };
}

io.on("connection", (socket) => {
  let currentTextRoom = null;
  let currentVoiceRoom = null;

  // ---- Kişisel hesap girişi ----
  socket.on("login", async ({ username, password }, callback) => {
    // GÜVENLİK: sadece "boş mu" değil, "gerçekten metin mi" diye de
    // AÇIKÇA kontrol ediyoruz — biri kullanıcı adı yerine özel
    // hazırlanmış bir nesne gönderirse (MongoDB sorgu operatörü gibi),
    // bunun sessizce bir "yan etkiye" güvenerek değil, kasıtlı olarak
    // reddedilmesini istiyoruz.
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
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

      // YENİ: Artık "üye olunan kanallar" değil, "ROLÜNE göre erişimi
      // olan kanallar" gönderiyoruz — istemci sadece bunları gösterecek,
      // şifre sorma diye bir şey yok artık.
      const userRoles = user.roles || [];
      const accessibleChannels = CHANNELS_CONFIG.filter((c) =>
        userCanAccessChannel(userRoles, c)
      ).map((c) => c.name);

      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        channels: accessibleChannels,
        avatarData: user.avatarData || null,
        // YENİ: istemcinin "ben admin miyim (Alganis rolü var mı)"
        // kontrolünü yapıp arayüzü ona göre göstermesi için. Gerçek
        // YETKİ kontrolü her zaman sunucuda, taze bir DB okumasıyla
        // tekrar yapılıyor — bu sadece arayüz gösterimi için.
        roles: userRoles,
      });
    } catch (err) {
      console.error("Giriş sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Kayıt olma — davet kodu ile sınırlı. Uygulamada bilerek
  // herkese açık bir kayıt formu YOKTU (bkz. add-user.js'teki eski not) —
  // çünkü sunucu adresini bulan HERKES hesap açıp en azından rol
  // gerektirmeyen kanallara (ör. Genel) girebilirdi. REGISTER_INVITE_CODE
  // ortam değişkeniyle eşleşmeyen istekler reddediliyor; kodu bilmeyen
  // biri (arkadaş grubunun dışından biri sunucu adresini bulsa bile)
  // hesap açamaz.
  socket.on("register", async ({ username, password, inviteCode }, callback) => {
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      typeof inviteCode !== "string"
    ) {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    const trimmedUsername = username.trim();
    if (!/^[\wÇĞİÖŞÜçğıöşü]{3,32}$/.test(trimmedUsername)) {
      return callback({
        success: false,
        message: "Kullanıcı adı 3-32 karakter olmalı, sadece harf/rakam/alt çizgi içerebilir.",
      });
    }
    if (password.length < 6) {
      return callback({ success: false, message: "Şifre en az 6 karakter olmalı." });
    }
    const expectedCode = process.env.REGISTER_INVITE_CODE;
    if (!expectedCode) {
      return callback({ success: false, message: "Kayıt şu anda kapalı." });
    }
    if (inviteCode !== expectedCode) {
      return callback({ success: false, message: "Davet kodu hatalı." });
    }

    try {
      const existing = await User.findOne({ username: trimmedUsername }).lean();
      if (existing) {
        return callback({ success: false, message: "Bu kullanıcı adı zaten alınmış." });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await User.create({ username: trimmedUsername, passwordHash, roles: [] });
      callback({ success: true });
    } catch (err) {
      console.error("Kayıt sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Metin kanalına katılma (SES BAĞLANTISI KURMAZ) ----
  socket.on("join-channel", async ({ roomId, token }) => {
    const username = resolveUsername(token);
    if (typeof roomId !== "string" || !roomId || !username) {
      socket.emit("join-error", "Önce giriş yapman gerekiyor.");
      return;
    }
    const channelConfig = CHANNELS_CONFIG.find((c) => c.name === roomId);
    if (!channelConfig) {
      socket.emit("join-error", "Böyle bir kanal yok.");
      return;
    }

    // YENİ: Şifre yerine ROL kontrolü — kullanıcının rollerinden en az
    // biri, kanalın izinli rolleri arasında olmalı.
    let userRoles = [];
    try {
      const user = await User.findOne({ username }).lean();
      userRoles = user?.roles || [];
    } catch (err) {
      console.error("Kullanıcı rolleri alınırken hata:", err.message);
    }
    if (!userCanAccessChannel(userRoles, channelConfig)) {
      socket.emit("join-error", "Bu kanala erişim yetkin yok.");
      return;
    }

    // DÜZELTME: artık istemci sesteyken kanal değiştirdiğinde (sesi
    // koparmadan başka bir kanalın mesajlarını okuyabilmek için) AYNI
    // soketi tekrar kullanıyor. Bu yüzden eski metin kanalından socket.io
    // oda üyeliğini burada AÇIKÇA bırakmazsak, o kanala yeni mesaj
    // geldiğinde bu soket hâlâ dinlemeye devam eder ve mesaj yanlışlıkla
    // görüntülenen YENİ kanalın sohbetine karışır. Ses odası (voiceRoomName)
    // bundan tamamen ayrı bir isim alanı olduğu için etkilenmiyor.
    if (currentTextRoom && currentTextRoom !== roomId) {
      socket.leave(textRoomName(currentTextRoom));
    }
    currentTextRoom = roomId;
    socket.join(textRoomName(roomId));
    if (!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.id] = { username };

    // Kalıcı üyelik kaydı — artık ERİŞİM için değil, sadece "çevrimdışı
    // üyeler" listesinde görünebilmek için (kim bu kanalı hiç açmış).
    try {
      await ChannelMember.findOneAndUpdate(
        { channel: roomId, username },
        { lastSeenAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error("Kanal üyeliği kaydedilirken hata:", err.message);
    }

    // YENİ: Bu kişiyi, ROLÜNE GÖRE ERİŞİMİ OLAN TÜM kanalların "bildirim"
    // odalarına katıyoruz — böylece o an başka bir kanaldayken bile,
    // erişimi olan diğer kanallarda yeni mesaj gelirse haberdar olabiliyor.
    CHANNELS_CONFIG.forEach((c) => {
      if (userCanAccessChannel(userRoles, c)) {
        socket.join(`member-notify:${c.name}`);
      }
    });

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
      socket.emit("message-history", history.reverse().map(serializeMessage));
    } catch (err) {
      console.error("Mesaj geçmişi alınırken hata:", err.message);
    }
  });

  // ---- YENİ: Sese katılma (metin kanalına zaten girmiş olmalı) ----
  socket.on("join-voice", async ({ token }) => {
    const username = resolveUsername(token);
    const roomId = currentTextRoom;
    if (!username || !roomId) return;

    // YENİ: profil fotoğrafını da eş bağlantı (peer) bilgisine ekliyoruz
    // ki karşı taraf kamerası kapalıyken avatar-yerine-baş-harf yerine
    // gerçek fotoğrafı görebilsin.
    let avatarData = null;
    try {
      const user = await User.findOne({ username }).select("avatarData").lean();
      avatarData = user?.avatarData || null;
    } catch (err) {
      console.error("Avatar alınırken hata:", err.message);
    }

    currentVoiceRoom = roomId;
    socket.join(voiceRoomName(roomId));
    if (!voiceRooms[roomId]) voiceRooms[roomId] = {};
    voiceRooms[roomId][socket.id] = {
      username,
      muted: true,
      cameraOn: false,
      sharingScreen: false,
      avatarData,
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
    // GÜVENLİK/SAĞLAMLIK: "text" beklenmedik bir tipte (ör. bir nesne)
    // gelirse .trim() çağrısı hata fırlatabilirdi — bunu try/catch'e
    // girmeden, en başta AÇIKÇA reddediyoruz.
    if (!username || !currentTextRoom || typeof text !== "string") return;
    const trimmedText = text.trim();
    if (!trimmedText || trimmedText.length > 2000) return;

    try {
      const message = await Message.create({
        channel: currentTextRoom,
        username,
        text: trimmedText,
      });
      io.to(textRoomName(currentTextRoom)).emit("new-message", {
        id: message._id.toString(),
        username: message.username,
        text: message.text,
        createdAt: message.createdAt,
        editedAt: null,
        reactions: [],
      });
      // YENİ: bu kanalın ÜYESİ olan ama şu an BAŞKA bir kanalda olan
      // kişilere hafif bir "burada bir şey oldu" işareti gönder —
      // okunmamış kanal işareti için. Kendisi zaten mesajı gördüğü
      // için göndereni hariç tutuyoruz.
      socket.to(`member-notify:${currentTextRoom}`).emit("channel-activity", {
        channel: currentTextRoom,
      });
    } catch (err) {
      console.error("Mesaj kaydedilirken hata:", err.message);
    }
  });

  // ---- YENİ: Yazıyor... göstergesi ----
  socket.on("typing-start", ({ token }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;
    socket.to(textRoomName(currentTextRoom)).emit("user-typing", { username });
  });
  socket.on("typing-stop", ({ token }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;
    socket.to(textRoomName(currentTextRoom)).emit("user-stopped-typing", { username });
  });

  // ---- YENİ: Mesaj emoji tepkisi (aç/kapa) ----
  socket.on("toggle-reaction", async ({ token, messageId, emoji }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;
    if (typeof messageId !== "string" || typeof emoji !== "string") return;
    if (emoji.length > 8) return; // tek bir emoji karakteri için fazlasıyla yeterli

    try {
      const message = await Message.findOne({ _id: messageId, channel: currentTextRoom });
      if (!message) return;

      const existingIndex = message.reactions.findIndex(
        (r) => r.username === username && r.emoji === emoji
      );
      if (existingIndex >= 0) {
        message.reactions.splice(existingIndex, 1);
      } else {
        message.reactions.push({ emoji, username });
      }
      await message.save();

      io.to(textRoomName(currentTextRoom)).emit("reactions-updated", {
        messageId,
        reactions: message.reactions,
      });
    } catch (err) {
      console.error("Tepki güncellenirken hata:", err.message);
    }
  });

  // ---- YENİ: Tek bir mesajı silme ----
  // GÜVENLİK: sadece KENDİ mesajını silebilirsin — başkasının mesajını
  // silme yetkisi hiç kimseye verilmiyor, "channel" ve "username" ikisi
  // birden eşleşmeli.
  socket.on("delete-message", async ({ token, messageId }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom || typeof messageId !== "string") return;

    try {
      // YENİ: Alganis rolündeki hesaplar BAŞKASININ tek bir mesajını da
      // silebilir (moderasyon, arayüzden tek tıkla) — normal kullanıcılar
      // hâlâ sadece kendi mesajını silebiliyor.
      const requester = await User.findOne({ username }).lean();
      const isAdmin = (requester?.roles || []).includes(ADMIN_ROLE);
      const filter = isAdmin
        ? { _id: messageId, channel: currentTextRoom }
        : { _id: messageId, channel: currentTextRoom, username };
      const result = await Message.deleteOne(filter);
      if (result.deletedCount > 0) {
        io.to(textRoomName(currentTextRoom)).emit("messages-deleted", { messageIds: [messageId] });
      }
    } catch (err) {
      console.error("Mesaj silinirken hata:", err.message);
    }
  });

  // ---- YENİ: Tek bir mesajı düzenleme ----
  // GÜVENLİK: sadece KENDİ mesajını düzenleyebilirsin.
  socket.on("edit-message", async ({ token, messageId, newText }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;
    if (typeof messageId !== "string" || typeof newText !== "string") return;
    const trimmed = newText.trim();
    if (!trimmed || trimmed.length > 2000) return;

    try {
      const message = await Message.findOne({
        _id: messageId,
        channel: currentTextRoom,
        username,
      });
      if (!message) return;
      message.text = trimmed;
      message.editedAt = new Date();
      await message.save();

      io.to(textRoomName(currentTextRoom)).emit("message-edited", {
        messageId,
        newText: trimmed,
        editedAt: message.editedAt,
      });
    } catch (err) {
      console.error("Mesaj düzenlenirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil n" komutu — KENDİ son N mesajını topluca sil ----
  // GÜVENLİK: sadece gönderenin KENDİ mesajları siliniyor — bir kanaldaki
  // TÜM geçmişi ya da başkalarının mesajlarını silme yetkisi yok. Bu,
  // "yanlışlıkla bir şey paylaştım, hemen geri alayım" senaryosu için.
  socket.on("delete-last-n", async ({ token, n }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;
    const count = Number(n);
    if (!Number.isInteger(count) || count < 1) return;
    const cappedCount = Math.min(count, 200); // aşırı büyük bir değere karşı makul bir tavan

    try {
      const toDelete = await Message.find({ channel: currentTextRoom, username })
        .sort({ createdAt: -1 })
        .limit(cappedCount)
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Silinecek mesajın yok.",
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(currentTextRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      socket.emit("new-message", {
        username: "Sistem",
        text: `${idsToDelete.length} mesajın silindi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Toplu mesaj silinirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil @kullanıcı n" komutu — SADECE ADMIN_ROLE rolüne
  // sahip hesaplar kullanabilir; hedef kullanıcının BU KANALDAKİ son N
  // mesajını siler. "!sil @kullanıcı"dan (tümünü siler) farkı: burada
  // sayıyla sınırlı, daha "cerrahi" bir moderasyon aracı.
  socket.on("delete-user-last-n", async ({ token, targetUsername, n }) => {
    const username = resolveUsername(token);
    const count = Number(n);
    if (
      !username ||
      !currentTextRoom ||
      typeof targetUsername !== "string" ||
      !targetUsername.trim() ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      return;
    }
    const target = targetUsername.trim();
    const cappedCount = Math.min(count, 200);

    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channel: currentTextRoom, username: target })
        .sort({ createdAt: -1 })
        .limit(cappedCount)
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          text: `${target} adlı kullanıcının bu kanalda silinecek mesajı yok.`,
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(currentTextRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      // YENİ: bu bir moderasyon eylemi — sadece komutu yazana değil,
      // kanaldaki HERKESE görünür oluyor (şeffaflık için).
      io.to(textRoomName(currentTextRoom)).emit("new-message", {
        username: "Sistem",
        text: `${username}, ${target} kullanıcısının son ${idsToDelete.length} mesajını sildi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Kullanıcının son mesajları silinirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil @kullanıcı" komutu — SADECE ADMIN_ROLE rolüne sahip
  // hesaplar kullanabilir; hedef kullanıcının BU KANALDAKİ tüm mesajlarını
  // siler (moderasyon: spam/uygunsuz içerik temizliği). delete-last-n'den
  // farkı: kendi mesajınla sınırlı değilsin ve sayı değil, kullanıcı adı
  // hedefliyorsun.
  socket.on("delete-user-messages", async ({ token, targetUsername }) => {
    const username = resolveUsername(token);
    if (
      !username ||
      !currentTextRoom ||
      typeof targetUsername !== "string" ||
      !targetUsername.trim()
    ) {
      return;
    }
    const target = targetUsername.trim();

    try {
      const requester = await User.findOne({ username }).lean();
      const requesterRoles = requester?.roles || [];
      if (!requesterRoles.includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channel: currentTextRoom, username: target })
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          text: `${target} adlı kullanıcının bu kanalda silinecek mesajı yok.`,
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(currentTextRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      // YENİ: bu bir moderasyon eylemi — sadece komutu yazana değil,
      // kanaldaki HERKESE görünür oluyor (şeffaflık için).
      io.to(textRoomName(currentTextRoom)).emit("new-message", {
        username: "Sistem",
        text: `${username}, ${target} kullanıcısının ${idsToDelete.length} mesajını sildi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Kullanıcının mesajları silinirken hata:", err.message);
    }
  });

  // ---- YENİ: Uygulama içi rol yönetimi — SADECE ADMIN_ROLE rolüne sahip
  // hesaplar kullanabilir. Kayıtlı TÜM kullanıcıları (rolleriyle birlikte)
  // döndürüyor — bir kanalı hiç açmamış olsalar bile (offline üye listesi
  // sadece o kanalı en az bir kere açmış kişileri gösteriyordu, bu ondan
  // bağımsız ve tam liste).
  socket.on("list-all-users", async ({ token }, callback) => {
    const username = resolveUsername(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const users = await User.find({}).select("username roles").sort({ username: 1 }).lean();
      callback({
        success: true,
        users: users.map((u) => ({ username: u.username, roles: u.roles || [] })),
      });
    } catch (err) {
      console.error("Kullanıcı listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir kullanıcıya rol ekleme/çıkarma — SADECE ADMIN_ROLE. ----
  socket.on("update-user-role", async ({ token, targetUsername, role, action }) => {
    const username = resolveUsername(token);
    if (
      !username ||
      typeof targetUsername !== "string" ||
      typeof role !== "string" ||
      !role.trim() ||
      (action !== "add" && action !== "remove")
    ) {
      return;
    }
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Bu işlemi yapma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }
      const roleTrimmed = role.trim();
      const update =
        action === "add" ? { $addToSet: { roles: roleTrimmed } } : { $pull: { roles: roleTrimmed } };
      const updated = await User.findOneAndUpdate({ username: targetUsername }, update, {
        new: true,
      }).lean();
      if (!updated) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Kullanıcı bulunamadı.",
          createdAt: new Date(),
        });
        return;
      }
      socket.emit("user-role-updated", { username: targetUsername, roles: updated.roles || [] });
    } catch (err) {
      console.error("Rol güncellenirken hata:", err.message);
    }
  });

  // ---- YENİ: Fotoğraf paylaşımı — WhatsApp'ın "tek seferlik" fotoğrafı
  // gibi: HİÇBİR YERE KAYDEDİLMİYOR, sadece o an kanalda olanlara
  // anlık iletiliyor. Kanaldan çıkıp girsen bile bir daha görünmez.
  socket.on("send-photo", ({ token, imageData, mimeType }) => {
    const username = resolveUsername(token);
    if (!username || !currentTextRoom) return;

    // GÜVENLİK: set-avatar ile AYNI açık burada da vardı — gerçek bir data
    // URI mi, beyan edilen mimeType ile eşleşiyor mu diye doğruluyoruz.
    if (!isValidImageDataUri(imageData, mimeType)) return;
    // ~10 MB'lık bir görsel, base64'e çevrilince kabaca 13.3 milyon
    // karaktere denk geliyor — biraz payla 14 milyonda sınır koyuyoruz.
    if (imageData.length > 14 * 1024 * 1024) return;

    const roomName = textRoomName(currentTextRoom);
    io.to(roomName).emit("new-photo", {
      username,
      imageData,
      mimeType,
      createdAt: new Date(),
    });
    socket.to(`member-notify:${currentTextRoom}`).emit("channel-activity", {
      channel: currentTextRoom,
    });

    // Küçük bir nezaket: o an kanalda gönderenden başka kimse yoksa,
    // bunu bilsin (fotoğraf "kayboldu", kimse görmedi).
    const othersInRoom = Object.values(textRooms[currentTextRoom] || {}).filter(
      (u) => u.username !== username
    );
    if (othersInRoom.length === 0) {
      socket.emit("new-message", {
        username: "Sistem",
        text: "Şu an kanalda başka kimse yoktu, fotoğrafı kimse görmedi.",
        createdAt: new Date(),
      });
    }
  });

  // ---- Daha eski mesajları getirme (geçmiş SINIRSIZ, parça parça) ----
  socket.on("load-older-messages", async ({ token, before }, callback) => {
    const username = resolveUsername(token);
    // GÜVENLİK DÜZELTMESİ: hangi kanaldan istediğimizi istemciden
    // ALMIYORUZ artık — sunucunun KENDİ, doğrulanmış kaydı olan
    // currentTextRoom'u kullanıyoruz. Önceki halinde, istemci
    // "channel" alanına özel hazırlanmış bir değer göndererek
    // teorik olarak BAŞKA bir kanalın (şifresini bilmediği bir
    // kanalın) mesajlarını isteyebilirdi — artık bu imkansız,
    // çünkü sadece kendi ZATEN girmiş olduğu kanalın geçmişini
    // isteyebiliyor.
    if (!username || !currentTextRoom) {
      if (typeof callback === "function") callback({ messages: [] });
      return;
    }
    try {
      const query = { channel: currentTextRoom };
      if (before) query.createdAt = { $lt: new Date(before) };
      const older = await Message.find(query).sort({ createdAt: -1 }).limit(50).lean();
      if (typeof callback === "function")
        callback({ messages: older.reverse().map(serializeMessage) });
    } catch (err) {
      console.error("Eski mesajlar alınırken hata:", err.message);
      if (typeof callback === "function") callback({ messages: [] });
    }
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
    if (typeof to !== "string" || !currentVoiceRoom) return;
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket || !targetSocket.rooms.has(voiceRoomName(currentVoiceRoom))) return;
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

  // ---- YENİ: Profil fotoğrafı belirleme — KALICI (send-photo'daki
  // geçici/tek seferlik fotoğraflardan farklı olarak veritabanına
  // yazılıyor). Küçük bir base64 data URL bekliyoruz; boyutu burada
  // sınırlıyoruz ki veritabanı büyük resimlerle şişmesin (bu bir profil
  // fotoğrafı, tam çözünürlüklü bir paylaşım değil).
  socket.on("set-avatar", async ({ token, imageData, mimeType }) => {
    const username = resolveUsername(token);
    if (!username) return;
    // GÜVENLİK: gerçekten bir data URI mi, beyan edilen mimeType ile
    // eşleşiyor mu — yoksa bir dış URL'yi profil fotoğrafı diye kaydedip
    // onu görecek herkesin istemcisini o adrese sessizce istek attırabilirdi.
    if (!isValidImageDataUri(imageData, mimeType)) return;
    if (imageData.length > 700_000) {
      // ~700 bin karakter ≈ 500 KB ham veri — küçük bir profil fotoğrafı
      // için fazlasıyla yeterli.
      socket.emit("new-message", {
        username: "Sistem",
        text: "Profil fotoğrafı çok büyük (maksimum ~500 KB). Daha küçük bir resim dene.",
        createdAt: new Date(),
      });
      return;
    }

    try {
      await User.updateOne({ username }, { avatarData: imageData });
      socket.emit("avatar-saved", { avatarData: imageData });

      // Şu an bulunduğu metin kanalındaki üye listesini (herkes için)
      // ve varsa ses odasındaki eş bağlantı durumunu anlık güncelle.
      if (currentTextRoom) {
        const memberList = await buildMemberList(currentTextRoom);
        io.to(textRoomName(currentTextRoom)).emit("channel-members", memberList);
      }
      if (currentVoiceRoom && voiceRooms[currentVoiceRoom]?.[socket.id]) {
        voiceRooms[currentVoiceRoom][socket.id].avatarData = imageData;
        socket.to(voiceRoomName(currentVoiceRoom)).emit("user-state-update", {
          socketId: socket.id,
          state: { avatarData: imageData },
        });
      }
    } catch (err) {
      console.error("Profil fotoğrafı kaydedilirken hata:", err.message);
    }
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
