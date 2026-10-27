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
const path = require("path");
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
// NOT: db.js'teki Mongoose modeli "Server" olarak dışa aktarılıyor ama bu
// isim, birkaç satır aşağıda socket.io'nun KENDİ "Server" sınıfıyla
// çakışıyor — o yüzden burada "ServerModel" adıyla içe aktarıyoruz.
const {
  connectDB,
  User,
  Message,
  ChannelMember,
  BannedIp,
  Session,
  Server: ServerModel,
  ServerMember,
  Channel,
} = require("./db");

// YENİ: "!sil @kullanıcı" komutuyla BAŞKASININ mesajlarını topluca silme
// yetkisi, sadece rolleri arasında bu ismi taşıyan hesap(lar)a ait. Rol
// atamak için server/add-user.js ile o hesabın roles listesine
// "Alganis" eklenmesi yeterli — kod tarafında ayrıca bir "admin" alanı yok,
// mevcut serbest-metin rol sistemi (bkz. userCanAccessChannel) kullanılıyor.
const ADMIN_ROLE = "Alganis";

// ------------------------------------------------------------
// YENİ: Giriş/kayıt saldırı korumaları (rate limiting)
// ------------------------------------------------------------
// GİRİŞ: bir HESAP 5 kez yanlış şifre denenince 15 dakikalığına
// kilitleniyor (bkz. User.failedLoginAttempts/loginLockedUntil, db.js) —
// bu, veritabanında kalıcı, sunucu yeniden başlasa bile devam eder.
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

// YENİ: "Beni hatırla" — işaretlenirse, giriş belirteci veritabanında
// (Session, db.js) 30 gün geçerli olacak şekilde saklanıyor. Her
// başarılı "resume-session" isteğinde süre yeniden 30 güne uzatılıyor
// (kayan pencere) — düzenli kullanan biri hiç çıkış yapmadığı sürece
// tekrar şifre girmek zorunda kalmaz.
const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// KAYIT: bir IP adresi kısa sürede çok fazla yanlış davet kodu denerse
// (otomatik/saldırı niteliğinde davranış — bir insanın elle deneyeceği
// makul sayının çok üzerinde), o IP KALICI olarak banlanıyor. Bu sayaç
// bilerek bellekte (in-memory) — sadece NİHAİ ban kararı veritabanına
// yazılıp kalıcı oluyor (bkz. BannedIp, db.js).
const MAX_REGISTER_ATTEMPTS_PER_WINDOW = 10;
const REGISTER_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const registerAttemptsByIp = new Map(); // ip -> { count, windowStart }
const bannedIpSet = new Set(); // ip -> banlı mı (hızlı kontrol için, DB'den yükleniyor)

// YENİ: "şu an bağlı olan X kullanıcısının soketleri hangileri" — bir IP
// banlandığında Alganis rolündeki BAĞLI hesaplara ANLIK uyarı
// gönderebilmek için (bkz. notifyAdmins).
const socketsByUsername = new Map(); // username -> Set<socket>

// YENİ: Render gibi bir ters vekil (reverse proxy) arkasında çalışıyoruz —
// socket.handshake.address doğrudan kullanılırsa, GERÇEK istemci IP'si
// yerine Render'ın kendi iç proxy IP'si görünür (bu da banlamayı tamamen
// işlevsiz kılar, hatta yanlışlıkla HERKESİ aynı IP'ymiş gibi gösterip
// tüm servisi kilitleme riski taşır). X-Forwarded-For başlığı, proxy
// zincirindeki GERÇEK istemciyi (ilk adres) taşır.
function getClientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address;
}

// YENİ: Alganis rolündeki, ŞU AN bağlı olan hesaplara anlık güvenlik
// uyarısı gönderiyor (ör. bir IP kalıcı banlandığında). Kimse bağlı
// değilse sessizce hiçbir şey yapmaz — banlar zaten kalıcı olarak
// kaydediliyor, "Üye Yönetimi" > "Güvenlik" bölümünden her zaman
// görülebilir.
async function notifyAdmins(event, payload) {
  try {
    const admins = await User.find({ roles: ADMIN_ROLE }).select("username").lean();
    admins.forEach(({ username }) => {
      const sockets = socketsByUsername.get(username);
      sockets?.forEach((s) => s.emit(event, payload));
    });
  } catch (err) {
    console.error("Adminlere bildirim gönderilirken hata:", err.message);
  }
}

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

// Ses odasındaki bir kişinin istemciden kabul edilen durumu: sadece bu üç
// alan ve sadece true/false.
function pickVoiceState(state) {
  const picked = {};
  for (const key of ["muted", "cameraOn", "sharingScreen"]) {
    if (typeof state?.[key] === "boolean") picked[key] = state[key];
  }
  return picked;
}

// Veritabanına bağlan (kişisel hesaplar için).
connectDB().then((connected) => {
  if (!connected) return;
  // YENİ: daha önce kalıcı banlanmış IP'leri belleğe yükle — sunucu
  // yeniden başlasa bile banlar geçerliliğini korusun diye.
  BannedIp.find({})
    .select("ip")
    .lean()
    .then((rows) => {
      rows.forEach((r) => bannedIpSet.add(r.ip));
      console.log(`${rows.length} banlı IP belleğe yüklendi.`);
    })
    .catch((err) => console.error("Banlı IP'ler yüklenirken hata:", err.message));
});

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

// YENİ: Web/PWA sürümü — masaüstü (Electron) uygulamasıyla AYNI React
// kaynağından üretilen build'i (desktop/dist), aynı sunucudan servis
// ediyoruz. Aynı origin'den geldiği için CORS'a ve desktop/index.html
// içindeki CSP'nin connect-src 'self' kuralına takılmadan Socket.io'ya
// bağlanabiliyor. "npm run build" desktop/ klasöründe ÖNCEDEN
// çalıştırılmış olmalı (Render build komutuna eklenmesi gerekiyor).
const desktopDistPath = path.join(__dirname, "..", "desktop", "dist");
app.use(express.static(desktopDistPath));

app.get("/status", (req, res) => {
  res.send("Sinyalleşme sunucusu çalışıyor.");
});

// SPA yedek yönlendirme: bilinen bir statik dosyaya karşılık gelmeyen
// her GET isteği index.html'e düşsün (Socket.io kendi /socket.io/
// yolunu bundan önce, Express'e hiç uğramadan kendi işliyor zaten).
app.get(/^(?!\/socket\.io\/).*/, (req, res) => {
  res.sendFile(path.join(desktopDistPath, "index.html"), (err) => {
    if (err) res.status(404).send("Bulunamadı — önce 'desktop' klasöründe build alınmış mı?");
  });
});

// ------------------------------------------------------------
// DURUM (bellekte tutuluyor)
// textRooms["Kanal"]  = { socketId: { username } }              — metin kanalında kim var
// voiceRooms["Kanal"] = { socketId: { username, muted, ... } }  — seste kim var (textRooms'un alt kümesi)
// ------------------------------------------------------------
const textRooms = {};
const voiceRooms = {};

// ------------------------------------------------------------
// OTURUMLAR
// Her giriş veritabanına yazılıyor (Session, db.js), böylece sunucu
// yeniden başlayınca (her deploy'da ve Render'ın ücretsiz planı uyuyup
// uyandığında) kimse atılmıyor. Veritabanında anahtarın kendisi değil
// SHA-256 özeti duruyor. Her olayda veritabanına gitmemek için bellekte
// bir önbellek var.
// ------------------------------------------------------------
// "Beni hatırla" seçilmediyse oturum son kullanımdan 1 gün sonra düşüyor
// (uygulama zaten anahtarı kapanınca unutuyor, bu sadece üst sınır).
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
// Kayan pencereyi veritabanında en fazla saatte bir uzatıyoruz.
const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const sessionCache = new Map(); // anahtar -> { username, rememberMe, expiresAt, refreshedAt }

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionDuration(rememberMe) {
  return rememberMe ? REMEMBER_ME_DURATION_MS : SESSION_DURATION_MS;
}

async function createSession(username, rememberMe) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + sessionDuration(rememberMe));
  try {
    await Session.create({ token: hashToken(token), username, rememberMe, expiresAt });
  } catch (err) {
    // Veritabanı o an yazılamıyorsa oturum yine de bellekte çalışsın.
    console.error("Oturum kaydedilirken hata:", err.message);
  }
  sessionCache.set(token, { username, rememberMe, expiresAt, refreshedAt: Date.now() });
  return token;
}

// Veritabanındaki geçerli oturum kaydı ya da null. Eski kayıtlarda anahtarın
// kendisi saklanıyordu: bulunursa yerinde özete çevriliyor.
async function findSession(token) {
  let session = await Session.findOne({ token: hashToken(token) });
  if (!session) {
    session = await Session.findOne({ token });
    if (session) {
      session.token = hashToken(token);
      await session.save();
    }
  }
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return session;
}

// Kayan pencere: kullanılan oturumun süresini yeniden başlat.
function refreshSession(token, cached) {
  cached.expiresAt = new Date(Date.now() + sessionDuration(cached.rememberMe));
  cached.refreshedAt = Date.now();
  Session.updateOne({ token: hashToken(token) }, { expiresAt: cached.expiresAt }).catch((err) =>
    console.error("Oturum süresi uzatılırken hata:", err.message)
  );
}

async function deleteSession(token) {
  sessionCache.delete(token);
  await Session.deleteMany({ token: { $in: [hashToken(token), token] } });
}

async function resolveUsername(token) {
  // YENİ (SADECE TEST İÇİN): ALLOW_TEST_TOKENS Render'da HİÇBİR ZAMAN
  // ayarlanmayacak — canlı sunucuda etkisiz.
  if (
    process.env.ALLOW_TEST_TOKENS === "true" &&
    typeof token === "string" &&
    token.startsWith("TEST_BYPASS:")
  ) {
    return token.slice("TEST_BYPASS:".length);
  }
  if (typeof token !== "string" || !token) return null;

  let cached = sessionCache.get(token);
  if (cached && cached.expiresAt < new Date()) {
    sessionCache.delete(token);
    cached = null;
  }
  if (!cached) {
    try {
      const session = await findSession(token);
      if (!session) return null;
      cached = {
        username: session.username,
        rememberMe: session.rememberMe !== false,
        expiresAt: session.expiresAt,
        refreshedAt: 0,
      };
      sessionCache.set(token, cached);
    } catch (err) {
      console.error("Oturum okunurken hata:", err.message);
      return null;
    }
  }
  if (Date.now() - cached.refreshedAt > SESSION_REFRESH_INTERVAL_MS) refreshSession(token, cached);
  return cached.username;
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

// Bir bağlantıyı ses odasından çıkarıp odadakilere haber veriyor. Bağlantı
// gerçekten odadaysa true döner; böylece aynı ayrılma iki kez duyurulmuyor.
function removeVoiceMember(roomId, socketId) {
  const room = voiceRooms[roomId];
  if (!room?.[socketId]) return false;
  delete room[socketId];
  if (Object.keys(room).length === 0) delete voiceRooms[roomId];
  io.to(voiceRoomName(roomId)).except(socketId).emit("voice-user-left", { socketId });
  io.sockets.sockets.get(socketId)?.leave(voiceRoomName(roomId));
  return true;
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

async function buildMemberList(channelId) {
  // Kanalda "çevrimiçi": kanalı o an açık tutan ya da kanalın sesinde olan
  // herkes (sesteyken başka bir kanala bakan da sesin olduğu kanalda
  // görünmeye devam ediyor). Liste kişi başına: iki cihazdan bağlanan biri
  // iki kez görünmüyor.
  const voiceUsernames = new Set(
    Object.values(voiceRooms[channelId] || {}).map((v) => v.username)
  );
  const onlineUsernames = new Set([
    ...Object.values(textRooms[channelId] || {}).map((u) => u.username),
    ...voiceUsernames,
  ]);
  const online = [...onlineUsernames].map((username) => ({
    username,
    inVoice: voiceUsernames.has(username),
  }));

  let offline = [];
  try {
    const allMembers = await ChannelMember.find({ channelId }).lean();
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
  // YENİ: şu an içinde bulunulan kanalın bağlı olduğu sunucu — mesaj
  // moderasyonu yetkisini (bkz. canModerateServer) her seferinde kanaldan
  // sunucuya geri gitmeden kontrol edebilmek için.
  let currentServerId = null;
  // YENİ: bu soketin kim olduğunu (join-channel'da belirleniyor) —
  // socketsByUsername kaydını doğru temizleyebilmek (disconnect'te) ve
  // adminlere anlık güvenlik uyarısı gönderebilmek için.
  let currentUsername = null;

  // ---- Kişisel hesap girişi ----
  socket.on("login", async ({ username, password, rememberMe }, callback) => {
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

      // YENİ: hesap kilitli mi? (5 yanlış şifreden sonra 15 dakikalığına,
      // ya da bir yönetici erken açana kadar — bkz. unlock-user-login).
      if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
        const minutesLeft = Math.ceil((user.loginLockedUntil - new Date()) / 60000);
        return callback({
          success: false,
          message: `Çok fazla yanlış deneme yapıldı. Hesabın ${minutesLeft} dakika kilitli, ya da bir yöneticiden açmasını iste.`,
        });
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        // YENİ: yanlış şifre sayacını artır, eşiği geçtiyse kilitle.
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
        }
        await user.save();
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }

      // Başarılı giriş — sayaç ve varsa kilit sıfırlanır.
      if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
        user.failedLoginAttempts = 0;
        user.loginLockedUntil = null;
        await user.save();
      }

      // "Beni hatırla" işaretliyse oturum 30 gün, değilse 1 gün geçerli
      // (ikisi de kullanıldıkça uzuyor, bkz. resolveUsername).
      const token = await createSession(user.username, rememberMe === true);

      // YENİ: ÇOKLU SUNUCU — artık tek bir kanal listesi değil, kullanıcının
      // erişebildiği SUNUCULARIN listesi gönderiliyor. İstemci, aktif
      // sunucuyu seçtikten sonra "server-channels" ile o sunucunun kanal
      // listesini ayrıca isteyecek.
      const userRoles = user.roles || [];
      const myServers = await getAccessibleServers(user.username, userRoles);

      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        myServers: myServers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === user.username,
        })),
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

  // ---- YENİ: "Beni hatırla" ile kaydedilmiş bir oturumu devam ettirme —
  // şifre GEREKMİYOR, çünkü elindeki token zaten önceki başarılı bir
  // girişin kanıtı. Uygulama açılışında localStorage'da bir token varsa
  // istemci bunu otomatik dener; başarısız olursa (süresi dolmuş/geçersiz)
  // normal giriş ekranına döner.
  socket.on("resume-session", async ({ token }, callback) => {
    if (typeof callback !== "function") return;
    if (typeof token !== "string" || !token) return callback({ success: false });
    try {
      const session = await findSession(token);
      if (!session) return callback({ success: false });
      const user = await User.findOne({ username: session.username });
      if (!user) {
        await deleteSession(token);
        return callback({ success: false });
      }

      // Kayan pencere: aktif kullanılan bir "beni hatırla" oturumu,
      // gerçekten hiç kullanılmadığı sürece süresi dolmasın diye her
      // devam ettirmede süreyi yeniden 30 güne uzatıyoruz.
      const cached = {
        username: user.username,
        rememberMe: session.rememberMe !== false,
        expiresAt: session.expiresAt,
        refreshedAt: 0,
      };
      sessionCache.set(token, cached);
      refreshSession(token, cached);

      const userRoles = user.roles || [];
      const myServers = await getAccessibleServers(user.username, userRoles);

      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        myServers: myServers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === user.username,
        })),
        avatarData: user.avatarData || null,
        roles: userRoles,
      });
    } catch (err) {
      console.error("Oturum devam ettirilirken hata:", err.message);
      callback({ success: false });
    }
  });

  // ---- YENİ: Çıkış yapma — hem bellek-içi hem kalıcı (Session)
  // kaydını temizliyor, "beni hatırla" ile bir daha otomatik girmesin.
  socket.on("logout", async ({ token }) => {
    if (typeof token !== "string" || !token) return;
    try {
      await deleteSession(token);
    } catch (err) {
      console.error("Oturum silinirken hata:", err.message);
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
    const ip = getClientIp(socket);

    // YENİ: bu IP daha önce saldırı niteliğinde davranış yüzünden
    // KALICI banlanmışsa, hiçbir şeyi kontrol etmeden AYNI genel
    // mesajla reddet — banlı olduğunu bilerek belli etmiyoruz (saldırgan
    // "engellendim" bilgisini alıp başka bir yol denemeye çalışmasın).
    if (bannedIpSet.has(ip)) {
      return callback({ success: false, message: "Davet kodu hatalı." });
    }

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
      // YENİ: yanlış davet kodu denemesini bu IP için say. Kısa sürede
      // (5 dakika) çok sayıda (10+) yanlış deneme = otomatik/saldırı
      // niteliğinde davranış demektir — bir insan bu kadar hızlı bu
      // kadar çok deneme yapmaz. Böyle bir durumda IP'yi KALICI banlıyoruz.
      const now = Date.now();
      const entry = registerAttemptsByIp.get(ip);
      if (!entry || now - entry.windowStart > REGISTER_ATTEMPT_WINDOW_MS) {
        registerAttemptsByIp.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count += 1;
        if (entry.count >= MAX_REGISTER_ATTEMPTS_PER_WINDOW) {
          bannedIpSet.add(ip);
          registerAttemptsByIp.delete(ip);
          try {
            await BannedIp.findOneAndUpdate(
              { ip },
              {
                ip,
                reason: "Kayıt ekranında kısa sürede çok sayıda yanlış davet kodu denemesi",
                attemptCount: entry.count,
                bannedAt: new Date(),
              },
              { upsert: true }
            );
          } catch (err) {
            console.error("IP banı kaydedilirken hata:", err.message);
          }
          console.warn(`[güvenlik] IP kalıcı banlandı: ${ip} (${entry.count} deneme)`);
          notifyAdmins("security-alert", {
            type: "ip-banned",
            ip,
            attemptCount: entry.count,
            reason: "Kayıt ekranında çok sayıda yanlış davet kodu denemesi",
          });
        }
      }
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

  // ---- YENİ: Sunucu oluşturma — hesabı olan herkes kişi başı 1 tane
  // açabilir (spam'e karşı). Sunucuyu açan kişi otomatik olarak o
  // sunucunun sahibi/tek adminidir.
  socket.on("create-server", async ({ token, name }, callback) => {
    const username = await resolveUsername(token);
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
    const username = await resolveUsername(token);
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
      await Message.deleteMany({ channelId: { $in: channelIds } });
      await ChannelMember.deleteMany({ channelId: { $in: channelIds } });
      await Channel.deleteMany({ serverId });
      await ServerMember.deleteMany({ serverId });
      await ServerModel.deleteOne({ _id: serverId });
      callback({ success: true });
    } catch (err) {
      console.error("Sunucu silinirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucuya davet koduyla katılma — hesap açma davetinden
  // (REGISTER_INVITE_CODE) TAMAMEN AYRI bir mekanizma: bu, zaten hesabı
  // olan birinin, arkadaşının sunucusuna katılması için.
  socket.on("join-server-by-invite", async ({ token, inviteCode }, callback) => {
    const username = await resolveUsername(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    if (typeof inviteCode !== "string" || !inviteCode.trim()) {
      return callback({ success: false, message: "Davet kodu gerekli." });
    }
    try {
      const server = await ServerModel.findOne({ inviteCode: inviteCode.trim() }).lean();
      if (!server) return callback({ success: false, message: "Geçersiz davet kodu." });
      const existing = await ServerMember.findOne({ serverId: server._id, username }).lean();
      if (existing) {
        return callback({ success: false, message: "Bu sunucuya zaten üyesin." });
      }
      await ServerMember.create({ serverId: server._id, username, isOwner: false });
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

  // ---- YENİ: Kullanıcının erişebildiği sunucuların listesi (login/resume
  // sırasında zaten gönderiliyor — bu, ör. bir sunucu oluşturduktan/
  // katıldıktan sonra listeyi anlık tazelemek için). ----
  socket.on("list-my-servers", async ({ token }, callback) => {
    const username = await resolveUsername(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const servers = await getAccessibleServers(username, userRoles);
      callback({
        success: true,
        servers: servers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === username,
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
    const username = await resolveUsername(token);
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
    const username = await resolveUsername(token);
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
      callback({
        success: true,
        channels: accessible.map((c) => ({ id: c._id.toString(), name: c.name })),
      });
    } catch (err) {
      console.error("Sunucu kanalları alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir sunucuya kanal ekleme — sadece sahibi ya da platform
  // admini. v1'de yeni sunucularda kanal-başına rol kısıtlaması yok
  // (allowedRoles her zaman boş = sunucunun tüm üyelerine açık).
  socket.on("create-channel", async ({ token, serverId, name }, callback) => {
    const username = await resolveUsername(token);
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
    const username = await resolveUsername(token);
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
    const username = await resolveUsername(token);
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
    } catch (err) {
      console.error("Üye çıkarılırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Metin kanalına katılma (SES BAĞLANTISI KURMAZ) ----
  // ÇOKLU SUNUCU: artık kanal ismi değil, hangi SUNUCUdaki hangi KANAL
  // (ikisi de ObjectId) belirtiliyor — oda/DB anahtarı olarak kanalın
  // ObjectId'si (channelId) kullanılıyor, isim çakışması riski kalmıyor.
  // İsteğe bağlı ack: yeni istemciler "kanala girdim" onayını bekleyip ondan
  // sonra (ör. yeniden bağlanınca) sese katılıyor. Eski istemciler ack
  // göndermiyor, onlar için join-error olayı aynen duruyor.
  socket.on("join-channel", async ({ serverId, channelId, token } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const fail = (message) => {
      socket.emit("join-error", message);
      reply({ success: false, message });
    };
    const username = await resolveUsername(token);
    if (typeof serverId !== "string" || typeof channelId !== "string" || !username) {
      fail("Önce giriş yapman gerekiyor.");
      return;
    }

    // YENİ: bu soketin sahibini kaydediyoruz — adminlere anlık güvenlik
    // uyarısı gönderebilmek (bkz. notifyAdmins) ve disconnect'te temizlik
    // yapabilmek için.
    if (currentUsername !== username) {
      if (currentUsername) socketsByUsername.get(currentUsername)?.delete(socket);
      currentUsername = username;
      if (!socketsByUsername.has(username)) socketsByUsername.set(username, new Set());
      socketsByUsername.get(username).add(socket);
    }

    // Sunucu üyeliği ve ROL kontrolü (kullanıcının rollerinden en az biri
    // kanalın izinli rolleri arasında olmalı).
    const access = await checkChannelAccess(username, channelId, serverId);
    if (access.error) {
      fail(access.error);
      return;
    }
    const userRoles = access.roles;

    // roomId artık kanalın ObjectId'sinin metin hali — hem Socket.io oda
    // adı hem de Message/ChannelMember sorgu anahtarı olarak kullanılıyor.
    const roomId = channelId;

    // DÜZELTME: artık istemci sesteyken kanal değiştirdiğinde (sesi
    // koparmadan başka bir kanalın mesajlarını okuyabilmek için) AYNI
    // soketi tekrar kullanıyor. Bu yüzden eski metin kanalından socket.io
    // oda üyeliğini burada AÇIKÇA bırakmazsak, o kanala yeni mesaj
    // geldiğinde bu soket hâlâ dinlemeye devam eder ve mesaj yanlışlıkla
    // görüntülenen YENİ kanalın sohbetine karışır. Ses odası (voiceRoomName)
    // bundan tamamen ayrı bir isim alanı olduğu için etkilenmiyor.
    // Eski kanalın çevrimiçi kaydı da siliniyor ve oradakilere güncel liste
    // gidiyor; eskiden kayıt kalıyor, kişi gezdiği kanallarda uygulamayı
    // kapattıktan sonra da çevrimiçi görünüyordu (H5).
    let previousTextRoom = null;
    if (currentTextRoom && currentTextRoom !== roomId) {
      previousTextRoom = currentTextRoom;
      socket.leave(textRoomName(previousTextRoom));
      if (textRooms[previousTextRoom]) {
        delete textRooms[previousTextRoom][socket.id];
        if (Object.keys(textRooms[previousTextRoom]).length === 0) delete textRooms[previousTextRoom];
      }
    }
    currentTextRoom = roomId;
    currentServerId = serverId;
    socket.join(textRoomName(roomId));
    if (!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.id] = { username };

    // Kalıcı üyelik kaydı — artık ERİŞİM için değil, sadece "çevrimdışı
    // üyeler" listesinde görünebilmek için (kim bu kanalı hiç açmış).
    try {
      await ChannelMember.findOneAndUpdate(
        { channelId: roomId, username },
        { lastSeenAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error("Kanal üyeliği kaydedilirken hata:", err.message);
    }

    // YENİ: Bu kişiyi, ROLÜNE GÖRE ERİŞİMİ OLAN, AYNI SUNUCUDAKİ TÜM
    // kanalların "bildirim" odalarına katıyoruz — böylece o an başka bir
    // kanaldayken bile, erişimi olan diğer kanallarda yeni mesaj gelirse
    // haberdar olabiliyor.
    try {
      const serverChannels = await Channel.find({ serverId }).lean();
      serverChannels.forEach((c) => {
        if (userCanAccessChannelDoc(userRoles, c)) {
          socket.join(`member-notify:${c._id}`);
        }
      });
    } catch (err) {
      console.error("Bildirim odalarına katılırken hata:", err.message);
    }

    // Diğer metin-kanalı üyelerine bildir.
    socket.to(textRoomName(roomId)).emit("member-online", { username });

    // Üye listesi (online + offline) — hem yeni katılana hem herkese
    // güncel listeyi gönderiyoruz (basit ve tutarlı kalsın diye).
    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
    if (previousTextRoom) {
      io.to(textRoomName(previousTextRoom)).emit(
        "channel-members",
        await buildMemberList(previousTextRoom)
      );
    }

    // Mesaj geçmişi (sadece yeni katılana).
    try {
      const history = await Message.find({ channelId: roomId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      socket.emit("message-history", history.reverse().map(serializeMessage));
    } catch (err) {
      console.error("Mesaj geçmişi alınırken hata:", err.message);
    }
    reply({ success: true });
  });

  // ---- Sese katılma ----
  // channelId verilmezse (eski istemciler) o an açık olan metin kanalının
  // sesine katılınıyor. Yeni istemci kanalı açıkça gönderiyor: yeniden
  // bağlanınca o sırada başka bir kanala bakıyor olsa bile sesin olduğu
  // kanala dönebilsin diye. state ile mikrofon/kamera/ekran durumu da
  // baştan doğru duyuruluyor.
  socket.on("join-voice", async ({ token, channelId, state } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const username = await resolveUsername(token);
    const roomId = typeof channelId === "string" ? channelId : currentTextRoom;
    if (!username || !roomId) {
      reply({ success: false, message: "Önce bir kanala girmen gerekiyor." });
      return;
    }
    if (roomId !== currentTextRoom) {
      const access = await checkChannelAccess(username, roomId);
      if (access.error) {
        reply({ success: false, message: access.error });
        return;
      }
    }

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

    // Bir kişi aynı anda tek yerden seste olur. Aynı adla başka bir ses
    // kaydı varsa onu sesten çıkarıyoruz: ya internet koptuğu için geride
    // kalan ve sunucunun henüz fark etmediği eski bağlantıdır (yoksa kişi
    // seste iki kez görünürdü), ya da kişinin ikinci cihazıdır.
    const changedRooms = new Set([roomId]);
    for (const [otherRoomId, members] of Object.entries(voiceRooms)) {
      for (const [otherSocketId, info] of Object.entries(members)) {
        if (otherSocketId === socket.id || info.username !== username) continue;
        removeVoiceMember(otherRoomId, otherSocketId);
        io.to(otherSocketId).emit("voice-replaced");
        changedRooms.add(otherRoomId);
      }
    }
    if (currentVoiceRoom && currentVoiceRoom !== roomId) {
      removeVoiceMember(currentVoiceRoom, socket.id);
      changedRooms.add(currentVoiceRoom);
    }

    const alreadyInRoom = !!voiceRooms[roomId]?.[socket.id];
    currentVoiceRoom = roomId;
    socket.join(voiceRoomName(roomId));
    if (!voiceRooms[roomId]) voiceRooms[roomId] = {};
    voiceRooms[roomId][socket.id] = {
      username,
      muted: true,
      cameraOn: false,
      sharingScreen: false,
      ...pickVoiceState(state),
      avatarData,
    };

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

  // ---- YENİ: Sesten çıkma (metin kanalında kalmaya devam eder) ----
  socket.on("leave-voice", async () => {
    const roomId = currentVoiceRoom;
    if (!roomId) return;
    currentVoiceRoom = null;
    removeVoiceMember(roomId, socket.id);

    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
  });

  // ---- Sohbet mesajı gönderme (kalıcı) ----
  socket.on("send-message", async ({ token, text }) => {
    const username = await resolveUsername(token);
    // GÜVENLİK/SAĞLAMLIK: "text" beklenmedik bir tipte (ör. bir nesne)
    // gelirse .trim() çağrısı hata fırlatabilirdi — bunu try/catch'e
    // girmeden, en başta AÇIKÇA reddediyoruz.
    if (!username || !currentTextRoom || typeof text !== "string") return;
    const trimmedText = text.trim();
    if (!trimmedText || trimmedText.length > 2000) return;

    try {
      const message = await Message.create({
        channelId: currentTextRoom,
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
        channelId: currentTextRoom,
      });
    } catch (err) {
      console.error("Mesaj kaydedilirken hata:", err.message);
    }
  });

  // ---- YENİ: Yazıyor... göstergesi ----
  socket.on("typing-start", async ({ token }) => {
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom) return;
    socket.to(textRoomName(currentTextRoom)).emit("user-typing", { username });
  });
  socket.on("typing-stop", async ({ token }) => {
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom) return;
    socket.to(textRoomName(currentTextRoom)).emit("user-stopped-typing", { username });
  });

  // ---- YENİ: Mesaj emoji tepkisi (aç/kapa) ----
  socket.on("toggle-reaction", async ({ token, messageId, emoji }) => {
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom) return;
    if (typeof messageId !== "string" || typeof emoji !== "string") return;
    if (emoji.length > 8) return; // tek bir emoji karakteri için fazlasıyla yeterli

    try {
      const message = await Message.findOne({ _id: messageId, channelId: currentTextRoom });
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
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom || typeof messageId !== "string") return;

    try {
      // YENİ: bu kanalın bağlı olduğu SUNUCUNUN sahibi (ya da platform
      // admini) BAŞKASININ tek bir mesajını da silebilir (moderasyon,
      // arayüzden tek tıkla) — normal kullanıcılar hâlâ sadece kendi
      // mesajını silebiliyor.
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const canModerate = await canModerateServer(username, userRoles, currentServerId);
      const filter = canModerate
        ? { _id: messageId, channelId: currentTextRoom }
        : { _id: messageId, channelId: currentTextRoom, username };
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
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom) return;
    if (typeof messageId !== "string" || typeof newText !== "string") return;
    const trimmed = newText.trim();
    if (!trimmed || trimmed.length > 2000) return;

    try {
      const message = await Message.findOne({
        _id: messageId,
        channelId: currentTextRoom,
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
    const username = await resolveUsername(token);
    if (!username || !currentTextRoom) return;
    const count = Number(n);
    if (!Number.isInteger(count) || count < 1) return;
    const cappedCount = Math.min(count, 200); // aşırı büyük bir değere karşı makul bir tavan

    try {
      const toDelete = await Message.find({ channelId: currentTextRoom, username })
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
    const username = await resolveUsername(token);
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
      const userRoles = requester?.roles || [];
      if (!(await canModerateServer(username, userRoles, currentServerId))) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channelId: currentTextRoom, username: target })
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
    const username = await resolveUsername(token);
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
      if (!(await canModerateServer(username, requesterRoles, currentServerId))) {
        socket.emit("new-message", {
          username: "Sistem",
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channelId: currentTextRoom, username: target })
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
    const username = await resolveUsername(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const users = await User.find({})
        .select("username roles loginLockedUntil")
        .sort({ username: 1 })
        .lean();
      const now = new Date();
      callback({
        success: true,
        users: users.map((u) => ({
          username: u.username,
          roles: u.roles || [],
          // YENİ: Üye Yönetimi'nde kilitli hesapları gösterip erken
          // açabilmek için (bkz. unlock-user-login).
          isLoginLocked: !!(u.loginLockedUntil && u.loginLockedUntil > now),
        })),
      });
    } catch (err) {
      console.error("Kullanıcı listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir kullanıcıya rol ekleme/çıkarma — SADECE ADMIN_ROLE. ----
  socket.on("update-user-role", async ({ token, targetUsername, role, action }) => {
    const username = await resolveUsername(token);
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

  // ---- YENİ: Kilitli bir hesabın girişini erken açma — SADECE
  // ADMIN_ROLE. 5 yanlış şifreden sonra otomatik kilitlenen hesaplar
  // için (bkz. login işleyicisi) — "istediğim zaman kaldırabileyim".
  socket.on("unlock-user-login", async ({ token, targetUsername }) => {
    const username = await resolveUsername(token);
    if (!username || typeof targetUsername !== "string" || !targetUsername.trim()) return;
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
      await User.updateOne(
        { username: targetUsername.trim() },
        { failedLoginAttempts: 0, loginLockedUntil: null }
      );
      socket.emit("user-login-unlocked", { username: targetUsername.trim() });
    } catch (err) {
      console.error("Giriş kilidi açılırken hata:", err.message);
    }
  });

  // ---- YENİ: Banlı IP listesi — SADECE ADMIN_ROLE. ----
  socket.on("list-banned-ips", async ({ token }, callback) => {
    const username = await resolveUsername(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const banned = await BannedIp.find({}).sort({ bannedAt: -1 }).lean();
      callback({
        success: true,
        bannedIps: banned.map((b) => ({
          ip: b.ip,
          reason: b.reason,
          attemptCount: b.attemptCount,
          bannedAt: b.bannedAt,
        })),
      });
    } catch (err) {
      console.error("Banlı IP listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir IP'nin banını kaldırma — SADECE ADMIN_ROLE. Yanlışlıkla
  // (ör. bir arkadaşın art arda yanlış davet kodu denemesi) banlanan
  // birini kurtarabilmek için. ----
  socket.on("unban-ip", async ({ token, ip }) => {
    const username = await resolveUsername(token);
    if (!username || typeof ip !== "string" || !ip.trim()) return;
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
      bannedIpSet.delete(ip.trim());
      registerAttemptsByIp.delete(ip.trim());
      await BannedIp.deleteOne({ ip: ip.trim() });
      socket.emit("ip-unbanned", { ip: ip.trim() });
    } catch (err) {
      console.error("IP banı kaldırılırken hata:", err.message);
    }
  });

  // ---- YENİ: Fotoğraf paylaşımı — WhatsApp'ın "tek seferlik" fotoğrafı
  // gibi: HİÇBİR YERE KAYDEDİLMİYOR, sadece o an kanalda olanlara
  // anlık iletiliyor. Kanaldan çıkıp girsen bile bir daha görünmez.
  socket.on("send-photo", async ({ token, imageData, mimeType }) => {
    const username = await resolveUsername(token);
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
      channelId: currentTextRoom,
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
    const username = await resolveUsername(token);
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
      const query = { channelId: currentTextRoom };
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
    // Gönderen de hâlâ odada olmalı (başka bir cihazdan sese girince bu
    // bağlantı odadan çıkarılmış olabilir, bkz. join-voice).
    if (!socket.rooms.has(voiceRoomName(currentVoiceRoom))) return;
    const targetSocket = io.sockets.sockets.get(to);
    if (!targetSocket || !targetSocket.rooms.has(voiceRoomName(currentVoiceRoom))) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---- Mikrofon / kamera / ekran paylaşımı durum güncellemesi ----
  // Sadece mikrofon/kamera/ekran alanları ve sadece true/false kabul
  // ediliyor. Eskiden gelen nesne olduğu gibi kayda kopyalanıyordu:
  // kurcalanmış bir istemci seste adını "Alganis" gösterebiliyor, avatar
  // alanına dış bir adres (takip pikseli) koyabiliyordu (H6).
  socket.on("state-update", (partialState) => {
    if (!currentVoiceRoom || !voiceRooms[currentVoiceRoom]?.[socket.id]) return;
    const state = pickVoiceState(partialState);
    if (Object.keys(state).length === 0) return;
    Object.assign(voiceRooms[currentVoiceRoom][socket.id], state);
    socket.to(voiceRoomName(currentVoiceRoom)).emit("user-state-update", {
      socketId: socket.id,
      state,
    });
  });

  // ---- YENİ: Profil fotoğrafı belirleme — KALICI (send-photo'daki
  // geçici/tek seferlik fotoğraflardan farklı olarak veritabanına
  // yazılıyor). Küçük bir base64 data URL bekliyoruz; boyutu burada
  // sınırlıyoruz ki veritabanı büyük resimlerle şişmesin (bu bir profil
  // fotoğrafı, tam çözünürlüklü bir paylaşım değil).
  socket.on("set-avatar", async ({ token, imageData, mimeType }) => {
    const username = await resolveUsername(token);
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
    // Hem baktığı metin kanalından hem (farklıysa) sesin olduğu kanaldan
    // çıkıyor; ikisine de güncel liste gidiyor.
    const leftRooms = new Set();
    if (currentVoiceRoom && removeVoiceMember(currentVoiceRoom, socket.id)) {
      leftRooms.add(currentVoiceRoom);
    }
    if (currentTextRoom && textRooms[currentTextRoom]?.[socket.id]) {
      delete textRooms[currentTextRoom][socket.id];
      if (Object.keys(textRooms[currentTextRoom]).length === 0) delete textRooms[currentTextRoom];
      leftRooms.add(currentTextRoom);
    }
    for (const roomId of leftRooms) {
      if (currentUsername) {
        try {
          await ChannelMember.findOneAndUpdate(
            { channelId: roomId, username: currentUsername },
            { lastSeenAt: new Date() }
          );
        } catch (err) {
          console.error("lastSeenAt güncellenirken hata:", err.message);
        }
      }
      const memberList = await buildMemberList(roomId);
      io.to(textRoomName(roomId)).emit("channel-members", memberList);
    }
    // YENİ: socketsByUsername kaydını temizle (bkz. join-channel).
    if (currentUsername) {
      const sockets = socketsByUsername.get(currentUsername);
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) socketsByUsername.delete(currentUsername);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor.`);
});
