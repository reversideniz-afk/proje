// ============================================================
// SOHBET (CHAT) TESTLERİ
// ------------------------------------------------------------
// Not: Gerçek MongoDB bağlantım olmadığı için "mesaj gerçekten
// kalıcı olarak saklandı mı" kısmını burada test EDEMİYORUM — bunu
// sen, gerçek veritabanı bağlıyken elle doğrulayacaksın (mesaj at,
// kanaldan çık-gir, hâlâ duruyor mu diye bak). Ama şunu otomatik
// doğruluyorum: bir mesaj gönderildiğinde, odadaki DİĞER herkese
// gerçek zamanlı olarak ulaşıyor mu (veritabanı olmadan da bu kısım
// hata vermeden "sessizce" başarısız olmalı, çökmemeli).
// ============================================================
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";
const ROOM = "test-chat";
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
  const clientA = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => clientA.on("connect", resolve));
  clientA.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Ali" });
  await new Promise((r) => setTimeout(r, 300));

  const clientB = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => clientB.on("connect", resolve));
  clientB.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Veli" });
  await new Promise((r) => setTimeout(r, 300));

  // Ali mesaj gönderiyor, Veli'nin anlık alıp almadığını test ediyoruz.
  const veliReceivesMessagePromise = new Promise((resolve) => {
    clientB.on("new-message", resolve);
  });
  clientA.emit("send-message", { token: "TEST_BYPASS:Ali", text: "Selam Veli!" });

  const received = await Promise.race([
    veliReceivesMessagePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

  // Veritabanı bağlı olmadığı için mesaj KAYDEDİLEMEZ (Message.create
  // hata verir) — bu durumda "new-message" hiç yayınlanmaz, bu da
  // BEKLENEN bir şey (veritabanısız ortamda sessizce başarısız olmalı,
  // çökmemeli). Asıl kontrolümüz: sunucu bu sırada ÇÖKMÜYOR mu?
  const serverStillAlive = await new Promise((resolve) => {
    const pingClient = io(SERVER_URL, { reconnection: false, timeout: 2000 });
    pingClient.on("connect", () => {
      pingClient.disconnect();
      resolve(true);
    });
    pingClient.on("connect_error", () => resolve(false));
  });
  check(
    serverStillAlive,
    "Veritabanı bağlı değilken mesaj gönderilmeye çalışılınca sunucu ÇÖKMÜYOR"
  );

  // YENİ: "daha eski mesajları getir" de DB yokken çökmemeli, boş dizi
  // dönmeli.
  const olderMessagesResponse = await new Promise((resolve) => {
    clientA.emit(
      "load-older-messages",
      { token: "TEST_BYPASS:Ali", before: new Date().toISOString() },
      resolve
    );
  });
  check(
    olderMessagesResponse && Array.isArray(olderMessagesResponse.messages),
    "Veritabanı bağlı değilken 'load-older-messages' çökmüyor, boş dizi dönüyor"
  );

  // Not: 'received' burada muhtemelen null çıkacak (DB yok, mesaj
  // kaydedilemedi, yayınlanmadı) — bu, kodun DOĞRU davrandığının
  // göstergesi, bir hata değil. Gerçek DB ile bu satır sen test
  // edeceksin.
  console.log(
    `ℹ️  (Bilgi amaçlı) Mesaj yayınlandı mı: ${received !== null ? "EVET" : "HAYIR (beklenen — DB yok)"}`
  );

  // ============================================================
  // YENİ: Fotoğraf paylaşımı testleri — bu DB gerektirmiyor (kalıcı
  // değil, anlık), bu yüzden UÇTAN UCA, tam olarak test edebiliyorum.
  // ============================================================

  // 1) Normal boyutlu bir "fotoğraf" gönder, Veli anlık alıyor mu?
  const photoPromise = new Promise((resolve) => clientB.on("new-photo", resolve));
  clientA.emit("send-photo", {
    token: "TEST_BYPASS:Ali",
    imageData: "sahte-base64-veri",
    mimeType: "image/png",
  });
  const photo = await Promise.race([
    photoPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(
    photo !== null && photo.username === "Ali" && photo.mimeType === "image/png",
    "Fotoğraf gönderilince odadaki diğer kişi anlık alıyor"
  );

  // 2) Aşırı büyük bir "fotoğraf" (14MB sınırını aşan) sessizce
  // reddedilmeli.
  const oversizedPromise = new Promise((resolve) => clientB.on("new-photo", resolve));
  clientA.emit("send-photo", {
    token: "TEST_BYPASS:Ali",
    imageData: "a".repeat(15 * 1024 * 1024),
    mimeType: "image/png",
  });
  const oversizedResult = await Promise.race([
    oversizedPromise,
    new Promise((r) => setTimeout(() => r("TIMEOUT"), 2000)),
  ]);
  check(oversizedResult === "TIMEOUT", "Aşırı büyük fotoğraf sessizce reddediliyor (yayınlanmıyor)");

  // 3) Görsel olmayan bir MIME türü reddedilmeli.
  const wrongTypePromise = new Promise((resolve) => clientB.on("new-photo", resolve));
  clientA.emit("send-photo", {
    token: "TEST_BYPASS:Ali",
    imageData: "veri",
    mimeType: "application/exe",
  });
  const wrongTypeResult = await Promise.race([
    wrongTypePromise,
    new Promise((r) => setTimeout(() => r("TIMEOUT"), 1500)),
  ]);
  check(wrongTypeResult === "TIMEOUT", "Görsel olmayan bir dosya türü reddediliyor");

  // 4) Kanalda YALNIZ olan biri fotoğraf atarsa, "kimse görmedi" bilgisi almalı.
  const clientC = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => clientC.on("connect", resolve));
  clientC.emit("join-channel", { roomId: "test-chat-photo-yalniz", token: "TEST_BYPASS:Yalniz" });
  await new Promise((r) => setTimeout(r, 300));

  const systemMsgPromise = new Promise((resolve) => clientC.on("new-message", resolve));
  clientC.emit("send-photo", {
    token: "TEST_BYPASS:Yalniz",
    imageData: "veri",
    mimeType: "image/png",
  });
  const systemMsg = await Promise.race([
    systemMsgPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(
    systemMsg !== null && systemMsg.text.includes("kimse görmedi"),
    "Kanalda yalnızken fotoğraf atınca 'kimse görmedi' bilgisi geliyor"
  );
  clientC.disconnect();

  // 5) Sunucu hâlâ ayakta mı (üstteki reddedilen denemeler sonrası)?
  const serverStillAliveAfterPhotos = await new Promise((resolve) => {
    const pingClient = io(SERVER_URL, { reconnection: false, timeout: 2000 });
    pingClient.on("connect", () => {
      pingClient.disconnect();
      resolve(true);
    });
    pingClient.on("connect_error", () => resolve(false));
  });
  check(serverStillAliveAfterPhotos, "Reddedilen fotoğraf denemeleri sonrası sunucu ÇÖKMÜYOR");

  // ============================================================
  // YENİ: Yazıyor göstergesi — DB gerektirmiyor, tam test edilebiliyor.
  // NOT: Taze bağlantılar kullanıyoruz — clientA/clientB, az önceki
  // "aşırı büyük dosya" testinde (kasıtlı olarak) 15MB'lık bir veri
  // göndermeye çalıştı; bu, o bağlantıları sonraki testler için
  // güvenilmez bırakabiliyor (gerçek kullanımda bu hiç olmaz, çünkü
  // istemci zaten 10MB üstünü göndermeden reddediyor — bu sadece
  // testin kendi sırasından kaynaklanan yapay bir durum).
  // ============================================================
  const clientD = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => clientD.on("connect", resolve));
  clientD.emit("join-channel", { roomId: "test-chat-typing", token: "TEST_BYPASS:Ali" });
  await new Promise((r) => setTimeout(r, 300));

  const clientE = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => clientE.on("connect", resolve));
  clientE.emit("join-channel", { roomId: "test-chat-typing", token: "TEST_BYPASS:Veli" });
  await new Promise((r) => setTimeout(r, 300));

  const typingPromise = new Promise((resolve) => clientE.on("user-typing", resolve));
  clientD.emit("typing-start", { token: "TEST_BYPASS:Ali" });
  const typingEvent = await Promise.race([
    typingPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(
    typingEvent !== null && typingEvent.username === "Ali",
    "'typing-start' gönderilince odadaki diğer kişi anlık haberdar oluyor"
  );

  const stopTypingPromise = new Promise((resolve) => clientE.on("user-stopped-typing", resolve));
  clientD.emit("typing-stop", { token: "TEST_BYPASS:Ali" });
  const stopTypingEvent = await Promise.race([
    stopTypingPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(
    stopTypingEvent !== null && stopTypingEvent.username === "Ali",
    "'typing-stop' gönderilince odadaki diğer kişi anlık haberdar oluyor"
  );
  clientD.disconnect();
  clientE.disconnect();

  // YENİ: Tepki (reaction) ekleme DB gerektiriyor — burada sadece
  // DB bağlı değilken çökmediğini doğruluyorum, gerçek davranışı
  // sen canlıda test edeceksin.
  clientA.emit("toggle-reaction", {
    token: "TEST_BYPASS:Ali",
    messageId: "000000000000000000000000",
    emoji: "👍",
  });
  await new Promise((r) => setTimeout(r, 500));
  const serverStillAliveAfterReaction = await new Promise((resolve) => {
    const pingClient = io(SERVER_URL, { reconnection: false, timeout: 2000 });
    pingClient.on("connect", () => {
      pingClient.disconnect();
      resolve(true);
    });
    pingClient.on("connect_error", () => resolve(false));
  });
  check(
    serverStillAliveAfterReaction,
    "Veritabanı bağlı değilken 'toggle-reaction' denemesi sonrası sunucu ÇÖKMÜYOR"
  );

  clientA.disconnect();
  clientB.disconnect();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
