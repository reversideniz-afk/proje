// HTTP yolları: masaüstü/web istemcisinin dosyaları, durum sayfası ve
// fotoğraf paylaşımı API'si.
const express = require("express");
const path = require("path");
const { Channel, User } = require("../db");
const { AVATAR_TYPES, avatarVersion } = require("../lib/avatars");
const { createRateLimiter } = require("../lib/limits");
const { app } = require("../lib/realtime");
const { relayPhoto } = require("../lib/rooms");
const { resolveUsername } = require("../lib/sessions");
const { textRooms } = require("../lib/state");
const { isValidImageDataUri } = require("../lib/validate");

// YENİ: Web/PWA sürümü — masaüstü (Electron) uygulamasıyla AYNI React
// kaynağından üretilen build'i (desktop/dist), aynı sunucudan servis
// ediyoruz. Aynı origin'den geldiği için CORS'a ve desktop/index.html
// içindeki CSP'nin connect-src 'self' kuralına takılmadan Socket.io'ya
// bağlanabiliyor. "npm run build" desktop/ klasöründe ÖNCEDEN
// çalıştırılmış olmalı (Render build komutuna eklenmesi gerekiyor).
const desktopDistPath = path.join(__dirname, "..", "..", "desktop", "dist");

app.use(express.static(desktopDistPath));

app.get("/status", (req, res) => {
  res.send("Sinyalleşme sunucusu çalışıyor.");
});

// ------------------------------------------------------------
// HTTP API — şimdilik sadece fotoğraf paylaşımı.
// Masaüstü uygulaması file:// adresinden açıldığı için başka kökenden
// istek yapıyor; anahtar başlıkta gittiği (çerez yok) için her kökene
// izin vermek güvenli.
// ------------------------------------------------------------
app.use("/api", (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Oturum anahtarı GÖVDE OKUNMADAN kontrol ediliyor: giriş yapmamış biri
// büyük bir gövde gönderip sunucuya işletemez.
async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const username = token ? await resolveUsername(token) : null;
  if (!username) {
    res.set("Connection", "close");
    return res.status(401).json({ success: false, message: "Önce giriş yapman gerekiyor." });
  }
  req.username = username;
  next();
}

// Kişi başına fotoğraf hızı: 5'lik kova, 10 saniyede bir yenileniyor.
const photoRateLimiters = new Map();

 // username -> createRateLimiter(...)
function allowPhoto(username) {
  if (!photoRateLimiters.has(username)) {
    photoRateLimiters.set(
      username,
      createRateLimiter({ default: { capacity: 5, refillPerSecond: 0.1 } }, {})
    );
  }
  return photoRateLimiters.get(username)("photo").allowed;
}

// ---- Fotoğraf paylaşımı — WhatsApp'ın "tek seferlik" fotoğrafı gibi:
// HİÇBİR YERE KAYDEDİLMİYOR, sadece o an kanalda olanlara iletiliyor.
// Sadece o an açık tuttuğun kanala gönderebilirsin. Eskiden Socket.IO
// üzerinden geliyordu; bu yüzden paket sınırı 15 MB'tı (H8).
app.post(
  "/api/photos",
  requireAuth,
  express.json({ limit: "15mb" }),
  async (req, res) => {
    const { channelId, imageData, mimeType } = req.body || {};
    // GÜVENLİK: gerçek bir data URI mi, beyan edilen mimeType ile
    // eşleşiyor mu (bkz. isValidImageDataUri — "takip pikseli" koruması).
    // ~10 MB'lık bir görsel base64'te kabaca 13,3 milyon karakter.
    if (
      typeof channelId !== "string" ||
      !isValidImageDataUri(imageData, mimeType) ||
      imageData.length > 14 * 1024 * 1024
    ) {
      return res.status(400).json({ success: false, message: "Geçersiz ya da çok büyük fotoğraf." });
    }
    const viewers = Object.entries(textRooms[channelId] || {});
    const senderSocketIds = viewers.filter(([, u]) => u.username === req.username).map(([id]) => id);
    if (senderSocketIds.length === 0) {
      return res.status(403).json({ success: false, message: "Önce kanala girmen gerekiyor." });
    }
    if (!allowPhoto(req.username)) {
      return res.status(429).json({ success: false, message: "Çok hızlı fotoğraf gönderiyorsun, biraz bekle." });
    }
    try {
      // Bildirime tıklayınca doğru sunucu açılsın diye kanalın sunucusu.
      const channel = await Channel.findById(channelId).select("serverId").lean();
      relayPhoto(channelId, channel?.serverId?.toString() || null, req.username, imageData, mimeType, senderSocketIds);
      res.json({ success: true });
    } catch (err) {
      console.error("Fotoğraf iletilirken hata:", err.message);
      res.status(500).json({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  }
);

// ---- Profil fotoğrafları (H26). Sürümü (v) güncel olan adres bir yıl
// önbellekte kalabiliyor; resim değişince istemciler yeni sürümlü adresi
// alıyor. Avatarlar sohbette herkese görünen bilgiler, giriş istemiyor
// (<img> etiketi başlıkta anahtar gönderemiyor).
app.get("/api/avatars/:username", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select("avatarData avatarUpdatedAt")
      .lean();
    const match = /^data:([a-z/+.-]+);base64,(.+)$/.exec(user?.avatarData || "");
    if (!match || !AVATAR_TYPES.includes(match[1])) return res.status(404).end();
    res.set("Content-Type", match[1]);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.set(
      "Cache-Control",
      req.query.v === avatarVersion(user.avatarUpdatedAt) ? "public, max-age=31536000, immutable" : "no-cache"
    );
    res.send(Buffer.from(match[2], "base64"));
  } catch (err) {
    console.error("Avatar okunurken hata:", err.message);
    res.status(500).end();
  }
});

// Davet bağlantısı: /davet/KOD -> /?davet=KOD. Uygulama dosyaları göreli
// yollarla yüklendiği için sayfa kökten açılmalı; uygulama daveti adres
// parametresinden okuyor.
app.get("/davet/:code", (req, res) => {
  res.redirect(302, `/?davet=${encodeURIComponent(req.params.code)}`);
});

// SPA yedek yönlendirme: bilinen bir statik dosyaya karşılık gelmeyen
// her GET isteği index.html'e düşsün (Socket.io kendi /socket.io/
// yolunu bundan önce, Express'e hiç uğramadan kendi işliyor zaten).
app.get(/^(?!\/socket\.io\/).*/, (req, res) => {
  res.sendFile(path.join(desktopDistPath, "index.html"), (err) => {
    if (err) res.status(404).send("Bulunamadı — önce 'desktop' klasöründe build alınmış mı?");
  });
});
