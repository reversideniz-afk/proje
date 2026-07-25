// ============================================================
// GİRİŞ SİSTEMİ TESTLERİ
// ------------------------------------------------------------
// Not: Sandbox'ımda gerçek bir MongoDB'ye bağlanamıyorum (ağ
// kısıtlaması), o yüzden "doğru hesapla giriş başarılı oluyor mu"
// kısmını burada test EDEMİYORUM — bunu sen, gerçek MongoDB Atlas
// bağlantın hazır olunca elle test edeceksin. Ama şunları
// otomatik doğruluyorum:
//   1) bcrypt hash/karşılaştırma doğru çalışıyor mu (şifreleme mantığı)
//   2) Kanal şifreleri doğru reddediyor/kabul ediyor mu (DB'ye hiç
//      ihtiyaç duymayan kısım)
//   3) MongoDB bağlı DEĞİLKEN bile sunucu çökmeden, düzgün bir hata
//      mesajıyla "giriş başarısız" diyebiliyor mu (sağlamlık testi)
// ============================================================
const bcrypt = require("bcryptjs");
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

async function testBcrypt() {
  const hash = await bcrypt.hash("gizliSifre123", 10);
  check(hash !== "gizliSifre123", "bcrypt.hash: şifre düz metin olarak SAKLANMIYOR (hash farklı)");

  const correctMatch = await bcrypt.compare("gizliSifre123", hash);
  check(correctMatch === true, "bcrypt.compare: doğru şifre eşleşiyor");

  const wrongMatch = await bcrypt.compare("yanlisSifre", hash);
  check(wrongMatch === false, "bcrypt.compare: yanlış şifre eşleşmiyor");
}

async function testChannelSecrets() {
  const client = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("connect_error", reject);
  });

  // Yanlış kanal şifresi
  const joinErrorPromise = new Promise((resolve) => client.on("join-error", resolve));
  client.emit("join-room", { roomId: "Genel", displayName: "Test", secret: "yanlis" });
  const joinError = await Promise.race([
    joinErrorPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(joinError !== null, "Yanlış KANAL şifresiyle giriş reddediliyor");

  // Doğru kanal şifresi
  const client2 = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    client2.on("connect", resolve);
    client2.on("connect_error", reject);
  });
  const existingUsersPromise = new Promise((resolve) => client2.on("existing-users", resolve));
  client2.emit("join-room", {
    roomId: "Genel",
    displayName: "Test2",
    secret: process.env.CHANNEL_SECRET_GENEL,
  });
  const existingUsers = await Promise.race([
    existingUsersPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(existingUsers !== null, "Doğru KANAL şifresiyle giriş kabul ediliyor");

  client.disconnect();
  client2.disconnect();
}

async function testLoginWithoutDatabase() {
  // MONGODB_URI bilerek ayarlamadan sunucuyu çalıştırıyoruz (bkz. aşağıdaki
  // shell komutu) — bu test, DB bağlı değilken "login" isteğinin sunucuyu
  // ÇÖKERTMEDEN, düzgün bir hata mesajıyla cevap verdiğini doğruluyor.
  const client = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("connect_error", reject);
  });

  const response = await new Promise((resolve) => {
    client.emit("login", { username: "kimse", password: "test" }, resolve);
  });

  check(
    response && response.success === false && typeof response.message === "string",
    "MongoDB bağlı değilken 'login' çökmüyor, düzgün bir hata mesajı dönüyor"
  );

  client.disconnect();
}

async function run() {
  await testBcrypt();
  await testChannelSecrets();
  await testLoginWithoutDatabase();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
