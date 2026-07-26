// ============================================================
// BOT TESTLERİ (v2 — istemci-üzerinden yayın mimarisi)
// ------------------------------------------------------------
// Not: Sandbox'ımda YouTube'a erişemiyorum, bu yüzden "!çal" ile
// gerçekten şarkı gelip gelmediğini burada test EDEMİYORUM. Ama
// şunları doğruluyorum:
//   1) Seste OLMAYAN biri "!çal" yazarsa nazikçe reddediliyor mu
//   2) Seste OLAN biri "!çal" yazınca sunucu çökmeden deniyor mu
//   3) "!durdur" (çalan bir şey yokken bile) sunucuyu çökertmiyor mu
//   4) /bot-audio HTTP ucu var mı, çöküyor mu
// ============================================================
const { io } = require("socket.io-client");
const http = require("http");

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

function httpGet(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", () => resolve(null));
  });
}

async function run() {
  const client = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => client.on("connect", resolve));
  client.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Ali" });
  await new Promise((r) => setTimeout(r, 300));

  // 1) Seste DEĞİLKEN "!çal" — nazikçe reddedilmeli.
  const rejectMsgPromise = new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.username !== "Ali") {
        client.off("new-message", handler);
        resolve(msg);
      }
    };
    client.on("new-message", handler);
  });
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!çal test şarkısı" });
  const rejectMsg = await Promise.race([
    rejectMsgPromise,
    new Promise((r) => setTimeout(() => r(null), 2000)),
  ]);
  check(
    rejectMsg !== null && rejectMsg.text.includes("sese katılman"),
    "Seste değilken '!çal' nazikçe reddediliyor"
  );

  // 2) Sese katıl, sonra tekrar dene — sunucu çökmemeli (YouTube'a
  // erişemesek bile).
  client.emit("join-voice", { token: "TEST_BYPASS:Ali" });
  await new Promise((r) => setTimeout(r, 300));
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!çal test şarkısı" });
  await new Promise((r) => setTimeout(r, 1500));

  const serverStillAlive = await new Promise((resolve) => {
    const pingClient = io(SERVER_URL, { reconnection: false, timeout: 2000 });
    pingClient.on("connect", () => {
      pingClient.disconnect();
      resolve(true);
    });
    pingClient.on("connect_error", () => resolve(false));
  });
  check(serverStillAlive, "Sesteyken '!çal' denemesi sonrası sunucu ÇÖKMÜYOR");

  // 3) "!durdur" (çalan bir şey yokken) çökertmemeli.
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!durdur" });
  await new Promise((r) => setTimeout(r, 500));
  const stillAlive2 = await new Promise((resolve) => {
    const pingClient = io(SERVER_URL, { reconnection: false, timeout: 2000 });
    pingClient.on("connect", () => {
      pingClient.disconnect();
      resolve(true);
    });
    pingClient.on("connect_error", () => resolve(false));
  });
  check(stillAlive2, "'!durdur' komutu sonrası sunucu ÇÖKMÜYOR");

  // 4) /bot-audio HTTP ucu var mı (parametre eksikse 400 dönmeli, çökmemeli).
  const status = await httpGet(`${SERVER_URL}/bot-audio`);
  check(status === 400, "/bot-audio adresi çalışıyor (url parametresi eksikken 400 dönüyor)");

  client.disconnect();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
