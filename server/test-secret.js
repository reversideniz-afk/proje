// ============================================================
// GÜVENLİK TESTİ: Oda şifresi gerçekten koruma sağlıyor mu?
// ------------------------------------------------------------
// Bu script, ROOM_SECRET ayarlıyken sunucuyu başlatıp:
//   1) Yanlış/eksik şifreyle girmeye çalışanın REDDEDİLDİĞİNİ,
//   2) Doğru şifreyle girenin KABUL EDİLDİĞİNİ doğruluyor.
// ============================================================
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.log(`❌ ${message}`);
    failed++;
  }
}

async function run() {
  // --- Yanlış şifreyle giriş denemesi ---
  const badClient = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => badClient.on("connect", resolve));

  const joinErrorPromise = new Promise((resolve) => {
    badClient.on("join-error", resolve);
  });
  const wrongUserJoinedPromise = new Promise((resolve) => {
    badClient.on("existing-users", resolve);
  });

  badClient.emit("join-room", {
    roomId: "test-guvenlik",
    displayName: "Kötü Niyetli",
    secret: "yanlis-sifre",
  });

  const joinError = await Promise.race([
    joinErrorPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  check(joinError !== null, "Yanlış şifreyle giriş REDDEDİLİYOR (join-error alındı)");

  // --- Doğru şifreyle giriş denemesi ---
  const goodClient = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => goodClient.on("connect", resolve));

  const existingUsersPromise = new Promise((resolve) => {
    goodClient.on("existing-users", resolve);
  });

  goodClient.emit("join-room", {
    roomId: "test-guvenlik",
    displayName: "Gerçek Kullanıcı",
    secret: process.env.ROOM_SECRET,
  });

  const existingUsers = await Promise.race([
    existingUsersPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  check(existingUsers !== null, "Doğru şifreyle giriş KABUL EDİLİYOR (existing-users alındı)");

  badClient.disconnect();
  goodClient.disconnect();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
