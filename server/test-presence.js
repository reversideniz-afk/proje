// ============================================================
// OTOMATİK PRESENCE TESTİ
// ------------------------------------------------------------
// YENİ MİMARİ: Artık "metin kanalına girmek" (join-channel) ile
// "sese girmek" (join-voice) AYRI iki adım. Bu test her ikisini de
// sırayla yapıyor (WebRTC/mesh davranışını test etmek için sese de
// girmemiz gerekiyor).
//
// Çalıştırmadan önce sunucunun ayakta olması gerekir:
//   ALLOW_TEST_TOKENS=true node server.js
// Sonra başka bir terminalde:
//   ALLOW_TEST_TOKENS=true node test-presence.js
// ============================================================

const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";
const ROOM = "test-oda";

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

// Yardımcı: bağlan + metin kanalına gir + sese gir (üçünü sırayla yapar).
async function connectJoinChannelAndVoice(name, roomId) {
  const client = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("connect_error", reject);
  });
  client.emit("join-channel", { roomId, token: `TEST_BYPASS:${name}` });
  await new Promise((r) => setTimeout(r, 200));
  client.emit("join-voice", { token: `TEST_BYPASS:${name}` });
  await new Promise((r) => setTimeout(r, 200));
  return client;
}

async function run() {
  // --- Ali kanala + sese giriyor ---
  const clientA = await connectJoinChannelAndVoice("Ali", ROOM);

  // --- Veli kanala + sese giriyor, Ali'nin onu görüp görmediğini test ediyoruz ---
  const clientB = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    clientB.on("connect", resolve);
    clientB.on("connect_error", reject);
  });
  clientB.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Veli" });
  await new Promise((r) => setTimeout(r, 200));

  const existingVoiceUsersPromise = new Promise((resolve) => {
    clientB.on("existing-voice-users", resolve);
  });
  const aliSeesVeliJoinVoicePromise = new Promise((resolve) => {
    clientA.on("voice-user-joined", resolve);
  });
  clientB.emit("join-voice", { token: "TEST_BYPASS:Veli" });

  const existingVoiceUsers = await existingVoiceUsersPromise;
  check(
    existingVoiceUsers.length === 1 && existingVoiceUsers[0].username === "Ali",
    "Veli sese girince, Ali'yi 'existing-voice-users' listesinde görüyor"
  );

  const joinedEvent = await aliSeesVeliJoinVoicePromise;
  check(
    joinedEvent.username === "Veli",
    "Ali, Veli'nin sese girişini 'voice-user-joined' ile anlık görüyor"
  );

  // --- Sinyal (WebRTC teklif/cevap/ICE) iletimini test ediyoruz ---
  const veliReceivesSignalPromise = new Promise((resolve) => {
    clientB.on("signal", resolve);
  });
  const dummySignalData = { type: "offer", sdp: { fake: "test-sdp" } };
  clientA.emit("signal", { to: joinedEvent.socketId, data: dummySignalData });

  const receivedSignal = await Promise.race([
    veliReceivesSignalPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  check(
    receivedSignal !== null &&
      receivedSignal.data.type === "offer" &&
      receivedSignal.data.sdp.fake === "test-sdp",
    "Ali'nin gönderdiği sinyal (offer) mesajı Veli'ye doğru şekilde iletiliyor"
  );

  // --- Veli tamamen ayrılıyor (disconnect), Ali'nin haberdar olup olmadığını test ediyoruz ---
  const aliSeesVeliLeavePromise = new Promise((resolve) => {
    clientA.on("voice-user-left", resolve);
  });
  clientB.disconnect();

  const leftEvent = await Promise.race([
    aliSeesVeliLeavePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  check(
    leftEvent !== null && leftEvent.socketId === joinedEvent.socketId,
    "Veli ayrılınca, Ali 'voice-user-left' ile anlık haberdar oluyor"
  );

  clientA.disconnect();

  // --- Mikrofon/kamera durum bildirimini test ediyoruz ---
  const clientC = await connectJoinChannelAndVoice("Can", ROOM);

  const clientD = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    clientD.on("connect", resolve);
    clientD.on("connect_error", reject);
  });
  clientD.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Efe" });
  await new Promise((r) => setTimeout(r, 200));

  const canSeesEfeJoinVoicePromise = new Promise((resolve) => {
    clientC.on("voice-user-joined", resolve);
  });
  clientD.emit("join-voice", { token: "TEST_BYPASS:Efe" });
  const efeJoinedEvent = await canSeesEfeJoinVoicePromise;

  check(
    efeJoinedEvent.cameraOn === false && efeJoinedEvent.muted === true,
    "Sese yeni katılan kişi, varsayılan olarak mikrofon/kamera KAPALI bilgisiyle diğerlerine bildiriliyor"
  );

  const canSeesStateUpdatePromise = new Promise((resolve) => {
    clientC.on("user-state-update", resolve);
  });
  clientD.emit("state-update", { cameraOn: true });

  const stateUpdate = await Promise.race([
    canSeesStateUpdatePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
  check(
    stateUpdate !== null &&
      stateUpdate.socketId === efeJoinedEvent.socketId &&
      stateUpdate.state.cameraOn === true,
    "Efe kamerasını açınca, Can 'user-state-update' ile anlık haberdar oluyor"
  );

  clientC.disconnect();
  clientD.disconnect();

  // --- 3 kişilik mesh senaryosu (sesteki herkesin birbirinden haberdar olması) ---
  const room2 = "test-oda-mesh";
  const p1 = await connectJoinChannelAndVoice("Kişi1", room2);

  const p2 = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    p2.on("connect", resolve);
    p2.on("connect_error", reject);
  });
  p2.emit("join-channel", { roomId: room2, token: "TEST_BYPASS:Kişi2" });
  await new Promise((r) => setTimeout(r, 200));

  const p1SeesP2JoinPromise = new Promise((resolve) => p1.on("voice-user-joined", resolve));
  p2.emit("join-voice", { token: "TEST_BYPASS:Kişi2" });
  await p1SeesP2JoinPromise;
  await new Promise((r) => setTimeout(r, 200));

  // Üçüncü kişi katılıyor — HEM Kişi1 HEM Kişi2'nin haberdar olması lazım.
  const p3 = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    p3.on("connect", resolve);
    p3.on("connect_error", reject);
  });
  p3.emit("join-channel", { roomId: room2, token: "TEST_BYPASS:Kişi3" });
  await new Promise((r) => setTimeout(r, 200));

  const p1SeesP3Promise = new Promise((resolve) => p1.on("voice-user-joined", resolve));
  const p2SeesP3Promise = new Promise((resolve) => p2.on("voice-user-joined", resolve));
  const p3ExistingVoiceUsersPromise = new Promise((resolve) =>
    p3.on("existing-voice-users", resolve)
  );
  p3.emit("join-voice", { token: "TEST_BYPASS:Kişi3" });

  const p3ExistingVoiceUsers = await p3ExistingVoiceUsersPromise;
  check(
    p3ExistingVoiceUsers.length === 2 &&
      p3ExistingVoiceUsers.some((u) => u.username === "Kişi1") &&
      p3ExistingVoiceUsers.some((u) => u.username === "Kişi2"),
    "3. kişi sese girince, önceki İKİ kişiyi de 'existing-voice-users' listesinde görüyor"
  );

  const [p1SawP3, p2SawP3] = await Promise.all([
    Promise.race([p1SeesP3Promise, new Promise((r) => setTimeout(() => r(null), 2000))]),
    Promise.race([p2SeesP3Promise, new Promise((r) => setTimeout(() => r(null), 2000))]),
  ]);
  check(
    p1SawP3?.username === "Kişi3" && p2SawP3?.username === "Kişi3",
    "3. kişi sese girince, önceki İKİ kişi de (Kişi1 VE Kişi2) 'voice-user-joined' ile ayrı ayrı haberdar oluyor"
  );

  p1.disconnect();
  p2.disconnect();
  p3.disconnect();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
