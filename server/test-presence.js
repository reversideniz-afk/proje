// ============================================================
// OTOMATİK PRESENCE TESTİ
// ------------------------------------------------------------
// Bu script, App.jsx'in kullanacağı socket.io-client mantığını
// GERÇEK bir Electron penceresi açmadan iki sahte istemciyle test
// eder. Sunucu kodunu her değiştirdiğimizde bu scripti tekrar
// çalıştırarak "hala doğru çalışıyor mu" diye hızlıca kontrol
// edebiliriz.
//
// Çalıştırmadan önce sunucunun ayakta olması gerekir:
//   node server.js
// Sonra başka bir terminalde:
//   node test-presence.js
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

async function run() {
  // --- Ali odaya giriyor ---
  const clientA = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    clientA.on("connect", resolve);
    clientA.on("connect_error", reject);
  });
  clientA.emit("join-room", { roomId: ROOM, displayName: "Ali" });

  // Sunucunun Ali'yi odaya eklemesi için kısa bekleme
  await new Promise((r) => setTimeout(r, 300));

  // --- Veli odaya giriyor, Ali'nin onu görüp görmediğini test ediyoruz ---
  const clientB = io(SERVER_URL, { reconnection: false });

  const existingUsersPromise = new Promise((resolve) => {
    clientB.on("existing-users", resolve);
  });
  const aliSeesVeliJoinPromise = new Promise((resolve) => {
    clientA.on("user-joined", resolve);
  });

  await new Promise((resolve, reject) => {
    clientB.on("connect", resolve);
    clientB.on("connect_error", reject);
  });
  clientB.emit("join-room", { roomId: ROOM, displayName: "Veli" });

  const existingUsers = await existingUsersPromise;
  check(
    existingUsers.length === 1 && existingUsers[0].displayName === "Ali",
    "Veli odaya girince, Ali'yi 'existing-users' listesinde görüyor"
  );

  const joinedEvent = await aliSeesVeliJoinPromise;
  check(
    joinedEvent.displayName === "Veli",
    "Ali, Veli'nin girişini 'user-joined' ile anlık görüyor"
  );

  // --- YENİ: sinyal (WebRTC teklif/cevap/ICE) iletimini test ediyoruz ---
  // Bu, App.jsx'teki createPeerConnection/offer-answer akışının
  // tamamen dayandığı sunucu mekanizması.
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

  // --- Veli ayrılıyor, Ali'nin haberdar olup olmadığını test ediyoruz ---
  const aliSeesVeliLeavePromise = new Promise((resolve) => {
    clientA.on("user-left", resolve);
  });

  clientB.disconnect();

  const leftEvent = await Promise.race([
    aliSeesVeliLeavePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

  check(
    leftEvent !== null && leftEvent.socketId === joinedEvent.socketId,
    "Veli ayrılınca, Ali 'user-left' ile anlık haberdar oluyor"
  );

  clientA.disconnect();

  // --- YENİ: mikrofon/kamera durum bildirimini test ediyoruz ---
  // Bu, App.jsx'teki "kamerayı kapat -> karşı tarafa haber ver" akışının
  // dayandığı tam mekanizma.
  const clientC = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    clientC.on("connect", resolve);
    clientC.on("connect_error", reject);
  });
  clientC.emit("join-room", { roomId: ROOM, displayName: "Can" });
  await new Promise((r) => setTimeout(r, 300));

  const clientD = io(SERVER_URL, { reconnection: false });
  const canSeesEfeJoinPromise = new Promise((resolve) => {
    clientC.on("user-joined", resolve);
  });
  await new Promise((resolve, reject) => {
    clientD.on("connect", resolve);
    clientD.on("connect_error", reject);
  });
  clientD.emit("join-room", { roomId: ROOM, displayName: "Efe" });
  const efeJoinedEvent = await canSeesEfeJoinPromise;

  check(
    efeJoinedEvent.cameraOn === false && efeJoinedEvent.muted === true,
    "Yeni katılan kişi, varsayılan olarak mikrofon/kamera KAPALI bilgisiyle diğerlerine bildiriliyor"
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

  // --- YENİ: 3 kişilik mesh senaryosu ---
  // Aşama 5'in dayandığı kural: "odada zaten olan HERKES, yeni gelene
  // ayrı ayrı teklif gönderir". Bunu doğrulamak için 3 sahte istemciyle
  // sunucunun herkese doğru bildirim yaptığını kontrol ediyoruz.
  const room2 = "test-oda-mesh";

  const p1 = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    p1.on("connect", resolve);
    p1.on("connect_error", reject);
  });
  p1.emit("join-room", { roomId: room2, displayName: "Kişi1" });
  await new Promise((r) => setTimeout(r, 200));

  const p2 = io(SERVER_URL, { reconnection: false });
  const p1SeesP2JoinPromise = new Promise((resolve) => p1.on("user-joined", resolve));
  await new Promise((resolve, reject) => {
    p2.on("connect", resolve);
    p2.on("connect_error", reject);
  });
  p2.emit("join-room", { roomId: room2, displayName: "Kişi2" });
  await p1SeesP2JoinPromise;
  await new Promise((r) => setTimeout(r, 200));

  // Üçüncü kişi katılıyor — HEM Kişi1 HEM Kişi2'nin haberdar olması lazım.
  const p1SeesP3Promise = new Promise((resolve) => p1.on("user-joined", resolve));
  const p2SeesP3Promise = new Promise((resolve) => p2.on("user-joined", resolve));

  const p3 = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    p3.on("connect", resolve);
    p3.on("connect_error", reject);
  });

  const p3ExistingUsersPromise = new Promise((resolve) => p3.on("existing-users", resolve));
  p3.emit("join-room", { roomId: room2, displayName: "Kişi3" });

  const p3ExistingUsers = await p3ExistingUsersPromise;
  check(
    p3ExistingUsers.length === 2 &&
      p3ExistingUsers.some((u) => u.displayName === "Kişi1") &&
      p3ExistingUsers.some((u) => u.displayName === "Kişi2"),
    "3. kişi odaya girince, önceki İKİ kişiyi de 'existing-users' listesinde görüyor"
  );

  const [p1SawP3, p2SawP3] = await Promise.all([
    Promise.race([p1SeesP3Promise, new Promise((r) => setTimeout(() => r(null), 2000))]),
    Promise.race([p2SeesP3Promise, new Promise((r) => setTimeout(() => r(null), 2000))]),
  ]);

  check(
    p1SawP3?.displayName === "Kişi3" && p2SawP3?.displayName === "Kişi3",
    "3. kişi girince, önceki İKİ kişi de (Kişi1 VE Kişi2) 'user-joined' ile ayrı ayrı haberdar oluyor"
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
