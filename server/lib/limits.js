// Saldırı korumaları: giriş/kayıt sınırları, IP banı, istemci IP'si ve olay
// başına hız sınırı.

// ------------------------------------------------------------
// YENİ: Giriş/kayıt saldırı korumaları (rate limiting)
// ------------------------------------------------------------
// GİRİŞ: bir HESAP 5 kez yanlış şifre denenince 15 dakikalığına
// kilitleniyor (bkz. User.failedLoginAttempts/loginLockedUntil, db.js) —
// bu, veritabanında kalıcı, sunucu yeniden başlasa bile devam eder.
const MAX_LOGIN_ATTEMPTS = 5;

const LOGIN_LOCK_MS = 15 * 60 * 1000;

// KAYIT: bir IP adresi kısa sürede çok fazla yanlış davet kodu denerse
// (otomatik/saldırı niteliğinde davranış — bir insanın elle deneyeceği
// makul sayının çok üzerinde), o IP KALICI olarak banlanıyor. Bu sayaç
// bilerek bellekte (in-memory) — sadece NİHAİ ban kararı veritabanına
// yazılıp kalıcı oluyor (bkz. BannedIp, db.js).
const MAX_REGISTER_ATTEMPTS_PER_WINDOW = 10;

const REGISTER_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

const registerAttemptsByIp = new Map();

 // ip -> { count, windowStart }
const bannedIpSet = new Set();

 // username -> Set<socket>

// YENİ: Render gibi bir ters vekil (reverse proxy) arkasında çalışıyoruz —
// socket.handshake.address doğrudan kullanılırsa, GERÇEK istemci IP'si
// yerine Render'ın kendi iç proxy IP'si görünür (bu da banlamayı tamamen
// işlevsiz kılar, hatta yanlışlıkla HERKESİ aynı IP'ymiş gibi gösterip
// tüm servisi kilitleme riski taşır). Gerçek adres X-Forwarded-For'da.
//
// Vekil, kendisine bağlanan adresi başlığın SONUNA ekliyor; baştaki
// değerleri istemcinin kendisi yazabiliyor. Eskiden ilk değer
// kullanılıyordu: biri başlığa sahte bir adres yazarak banı atlatabilir
// ya da bir arkadaşının adresini banlatabilirdi (H20). TRUSTED_PROXY_HOPS,
// uygulamanın önündeki güvenilir vekil sayısı (Render: 1).
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

function getClientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const hops = forwarded
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[Math.max(0, hops.length - TRUSTED_PROXY_HOPS)];
  }
  return socket.handshake.address;
}

// Giriş için IP başına sınır: 10 dakikada 20 yanlış şifreden sonra o
// adresten giriş, pencere dolana kadar reddediliyor. Hesap başına kilit
// (5 yanlış şifre) farklı hesaplara sırayla deneme yapılmasını
// durdurmuyordu.
const MAX_LOGIN_FAILURES_PER_IP = 20;

const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

const loginFailuresByIp = new Map();

 // ip -> { count, windowStart }

function isLoginBlockedForIp(ip) {
  const entry = loginFailuresByIp.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > LOGIN_FAILURE_WINDOW_MS) {
    loginFailuresByIp.delete(ip);
    return false;
  }
  return entry.count >= MAX_LOGIN_FAILURES_PER_IP;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginFailuresByIp.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_FAILURE_WINDOW_MS) {
    loginFailuresByIp.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

// ------------------------------------------------------------
// Hız sınırı (H8): her bağlantı için olay grubuna göre bir jeton kovası.
// Kova dolu başlıyor, her olay bir jeton harcıyor, jetonlar zamanla
// yenileniyor. Sınırı aşan olay sessizce atılıyor (cevap bekleyen olaya
// "çok hızlı" yanıtı gidiyor).
// ------------------------------------------------------------
const RATE_LIMITS = {
  chat: { capacity: 8, refillPerSecond: 1.5 },
  auth: { capacity: 5, refillPerSecond: 0.3 },
  // WebRTC bağlantısı kurulurken kısa sürede onlarca ICE adayı gidiyor.
  signal: { capacity: 300, refillPerSecond: 60 },
  default: { capacity: 40, refillPerSecond: 10 },
};

const EVENT_GROUPS = {
  "send-message": "chat",
  "send-photo": "chat",
  "edit-message": "chat",
  "delete-message": "chat",
  "toggle-reaction": "chat",
  "delete-last-n": "chat",
  "delete-user-last-n": "chat",
  "delete-user-messages": "chat",
  login: "auth",
  register: "auth",
  "resume-session": "auth",
  // Mevcut şifreyi tahmin etmeyi de girişle aynı sınır yavaşlatıyor.
  "change-password": "auth",
  // Davet kodu tahmin etmeyi yavaşlatmak için girişle aynı sıkı sınır.
  "invite-info": "auth",
  "join-server-by-invite": "auth",
  signal: "signal",
};

function createRateLimiter(limits = RATE_LIMITS, groups = EVENT_GROUPS) {
  const buckets = {};
  return (event) => {
    const group = groups[event] || "default";
    const { capacity, refillPerSecond } = limits[group];
    const now = Date.now();
    const bucket = (buckets[group] ||= { tokens: capacity, updatedAt: now });
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + ((now - bucket.updatedAt) / 1000) * refillPerSecond
    );
    bucket.updatedAt = now;
    if (bucket.tokens < 1) return { allowed: false, group };
    bucket.tokens -= 1;
    return { allowed: true, group };
  };
}

module.exports = { MAX_LOGIN_ATTEMPTS, LOGIN_LOCK_MS, MAX_REGISTER_ATTEMPTS_PER_WINDOW, REGISTER_ATTEMPT_WINDOW_MS, registerAttemptsByIp, bannedIpSet, TRUSTED_PROXY_HOPS, getClientIp, MAX_LOGIN_FAILURES_PER_IP, LOGIN_FAILURE_WINDOW_MS, loginFailuresByIp, isLoginBlockedForIp, recordLoginFailure, RATE_LIMITS, EVENT_GROUPS, createRateLimiter };
