// ============================================================
// BOT TESTLERİ
// ------------------------------------------------------------
// Not: Sandbox'ımda YouTube'a erişemiyorum, bu yüzden "!çal" ile
// gerçekten şarkı gelip gelmediğini burada test EDEMİYORUM — bunu
// sen canlıda deneyeceksin. Ama şunları doğruluyorum:
//   1) Bot her kanalda otomatik üye listesinde görünüyor mu
//   2) "!katıl" komutu botu sese gerçekten ekliyor mu
//   3) "!ayrıl" komutu botu sesten çıkarıyor mu
//   4) Geçersiz bir "!çal" denemesi (YouTube'a erişilemediği için
//      başarısız olacak) sunucuyu ÇÖKERTMİYOR mu
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
  const client = io(SERVER_URL, { reconnection: false });
  await new Promise((resolve) => client.on("connect", resolve));

  const membersPromise = new Promise((resolve) => client.on("channel-members", resolve));
  client.emit("join-channel", { roomId: ROOM, token: "TEST_BYPASS:Ali" });
  const members = await membersPromise;

  check(
    members.online.some((m) => m.isBot),
    "Bot, kanala hiç komut yazılmadan bile üye listesinde otomatik görünüyor"
  );

  // "!katıl" komutu
  const joinMembersPromise = new Promise((resolve) => {
    const handler = (list) => {
      const bot = list.online.find((m) => m.isBot);
      if (bot?.inVoice) {
        client.off("channel-members", handler);
        resolve(list);
      }
    };
    client.on("channel-members", handler);
  });
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!katıl" });

  const afterJoin = await Promise.race([
    joinMembersPromise,
    new Promise((r) => setTimeout(() => r(null), 3000)),
  ]);
  check(afterJoin !== null, "'!katıl' komutu sonrası bot sesteymiş gibi görünüyor (inVoice: true)");

  // Sunucu hâlâ ayakta mı (YouTube'a erişilemeyen bir "!çal" denemesi sonrası)?
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!çal bu bulunamayacak bir şey" });
  await new Promise((r) => setTimeout(r, 2000));

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
    "YouTube'a erişilemeyen bir '!çal' denemesi sonrası sunucu ÇÖKMÜYOR"
  );

  // "!ayrıl" komutu
  const leaveMembersPromise = new Promise((resolve) => {
    const handler = (list) => {
      const bot = list.online.find((m) => m.isBot);
      if (bot && !bot.inVoice) {
        client.off("channel-members", handler);
        resolve(list);
      }
    };
    client.on("channel-members", handler);
  });
  client.emit("send-message", { token: "TEST_BYPASS:Ali", text: "!ayrıl" });

  const afterLeave = await Promise.race([
    leaveMembersPromise,
    new Promise((r) => setTimeout(() => r(null), 3000)),
  ]);
  check(afterLeave !== null, "'!ayrıl' komutu sonrası bot sesten çıkmış görünüyor (inVoice: false)");

  client.disconnect();

  console.log(`\n${passed} geçti, ${failed} kaldı.`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test çalıştırılırken hata oluştu:", err.message);
  process.exit(1);
});
