// Oturumlar: giriş anahtarlarının oluşturulması, doğrulanması ve silinmesi.
const crypto = require("crypto");
const { Session } = require("../db");

// YENİ: "Beni hatırla" — işaretlenirse, giriş belirteci veritabanında
// (Session, db.js) 30 gün geçerli olacak şekilde saklanıyor. Her
// başarılı "resume-session" isteğinde süre yeniden 30 güne uzatılıyor
// (kayan pencere) — düzenli kullanan biri hiç çıkış yapmadığı sürece
// tekrar şifre girmek zorunda kalmaz.
const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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

const sessionCache = new Map();

 // anahtar -> { username, rememberMe, expiresAt, refreshedAt }

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

// Kişinin keepToken dışındaki bütün oturumlarını siler (şifre değişince).
async function deleteOtherSessions(username, keepToken) {
  for (const [token, cached] of sessionCache) {
    if (cached.username === username && token !== keepToken) sessionCache.delete(token);
  }
  const keep = keepToken ? [hashToken(keepToken), keepToken] : [];
  await Session.deleteMany({ username, token: { $nin: keep } });
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

module.exports = { REMEMBER_ME_DURATION_MS, SESSION_DURATION_MS, SESSION_REFRESH_INTERVAL_MS, sessionCache, hashToken, sessionDuration, createSession, findSession, refreshSession, deleteSession, deleteOtherSessions, resolveUsername };
