// ============================================================
// ÇOKLU SUNUCU GEÇİŞ SCRİPTİ (tek seferlik)
// ------------------------------------------------------------
// Bugüne kadar Disco tek bir "sunucu" gibi çalışıyordu — kanallar
// Render'daki CHANNEL_N_NAME/CHANNEL_N_ROLES ortam değişkenlerinden
// geliyordu. Bu betik, o kanalları veritabanına taşıyıp bir "Disco"
// sunucusu altında topluyor, mevcut mesajları/kanal üyeliklerini yeni
// Channel kayıtlarına bağlıyor ve her mevcut kullanıcı için bu sunucuda
// bir üyelik kaydı oluşturuyor — kimse mevcut erişimini kaybetmiyor.
//
// GÜVENLİK: Bu betik İDEMPOTENT — yani yarıda kesilirse ya da yanlışlıkla
// iki kez çalıştırılırsa, zaten taşınmış olan kayıtları tekrar
// oluşturmaz/bozmaz (her adım "yoksa oluştur" mantığıyla çalışıyor).
//
// KULLANIM:
//   1) Bu klasörde bir ".env" dosyası olmalı, içinde production'daki
//      İLE AYNI MONGODB_URI ve CHANNEL_N_NAME/CHANNEL_N_ROLES
//      değişkenleri bulunmalı (Render Environment panelinden kopyala).
//   2) Önce KURU ÇALIŞTIRMA (hiçbir şey yazmaz, sadece ne yapacağını
//      gösterir) ile kontrol et:
//        node migrate-to-servers.js --dry-run
//   3) Sonuçlar doğru görünüyorsa gerçekten çalıştır:
//        node migrate-to-servers.js
// ============================================================

require("dotenv").config();
const crypto = require("crypto");
const {
  connectDB,
  User,
  Message,
  ChannelMember,
  Server: ServerModel,
  ServerMember,
  Channel,
} = require("./db");

const ADMIN_ROLE = "Alganis";
const DRY_RUN = process.argv.includes("--dry-run");

function loadChannelsConfig() {
  const channels = [];
  for (let i = 1; i <= 20; i++) {
    const name = process.env[`CHANNEL_${i}_NAME`];
    if (!name) continue;
    const rolesRaw = process.env[`CHANNEL_${i}_ROLES`] || "";
    const allowedRoles = rolesRaw.split(",").map((r) => r.trim()).filter(Boolean);
    channels.push({ name, allowedRoles });
  }
  return channels;
}

function generateInviteCode() {
  return crypto.randomBytes(9).toString("base64url"); // ör. "K3f9pQZ_x1m"
}

async function main() {
  console.log(DRY_RUN ? "🔍 KURU ÇALIŞTIRMA — hiçbir şey yazılmayacak.\n" : "▶️ Gerçek geçiş başlıyor.\n");

  const connected = await connectDB();
  if (!connected) {
    console.error("MongoDB'ye bağlanılamadı — MONGODB_URI ayarlı mı kontrol et.");
    process.exit(1);
  }

  // TEŞHİS: hangi veritabanına bağlandığımızı ve genel doküman sayılarını
  // (kanal ismiyle eşleştirmeden) gösteriyoruz — "taşınacak mesaj: 0" gibi
  // şüpheli bir sonuç, YANLIŞ veritabanına bağlanıldığının işareti olabilir.
  const mongoose = require("mongoose");
  console.log(`Bağlanılan veritabanı adı: "${mongoose.connection.name}"`);
  const totalMessages = await Message.countDocuments({});
  const totalUsers = await User.countDocuments({});
  console.log(`Toplam mesaj sayısı (kanal ayrımı yapılmadan): ${totalMessages}`);
  console.log(`Toplam kullanıcı sayısı: ${totalUsers}`);
  if (totalMessages > 0) {
    const distinctChannels = await Message.distinct("channel");
    console.log(`Mesajlarda geçen farklı kanal isimleri: ${distinctChannels.join(", ")}`);
  }
  console.log("");

  const CHANNELS_CONFIG = loadChannelsConfig();
  if (CHANNELS_CONFIG.length === 0) {
    console.error(
      "Hiç kanal bulunamadı (CHANNEL_1_NAME vb. .env'de yok) — betik burada duruyor."
    );
    process.exit(1);
  }
  console.log(`Env'den ${CHANNELS_CONFIG.length} kanal okundu: ${CHANNELS_CONFIG.map((c) => c.name).join(", ")}`);

  // TEŞHİS: env'den okunan her kanal ismini, mesajlarda geçen isimlerle
  // TAM (byte byte) karşılaştırıyoruz — görünüşte aynı görünen ama
  // görünmeyen bir boşluk/farklı karakter kodlaması yüzünden eşleşmeyen
  // isimleri yakalamak için.
  const distinctMessageChannels = await Message.distinct("channel");
  console.log("\n--- Kanal ismi eşleştirme teşhisi ---");
  CHANNELS_CONFIG.forEach((c) => {
    const exactMatch = distinctMessageChannels.includes(c.name);
    console.log(
      `env: ${JSON.stringify(c.name)} (${c.name.length} karakter) → mesajlarda ${exactMatch ? "TAM EŞLEŞTİ ✅" : "eşleşme YOK ❌"}`
    );
  });
  console.log("\nMesajlarda geçen kanal isimleri (ham):");
  distinctMessageChannels.forEach((name) => {
    console.log(`  ${JSON.stringify(name)} (${name.length} karakter)`);
  });
  console.log("--- teşhis sonu ---\n");

  // 1) Sunucunun sahibi olacak hesabı bul (Alganis rolündeki hesap).
  const ownerUser = await User.findOne({ roles: ADMIN_ROLE }).lean();
  if (!ownerUser) {
    console.error(
      `"${ADMIN_ROLE}" rolüne sahip hiçbir kullanıcı bulunamadı — sunucunun sahibi belirlenemiyor, betik durduruldu.`
    );
    process.exit(1);
  }
  console.log(`Sunucu sahibi: ${ownerUser.username}`);

  // 2) Eski/miras "Disco" sunucusunu bul ya da oluştur (idempotent).
  let legacyServer = await ServerModel.findOne({
    name: "Disco",
    ownerUsername: ownerUser.username,
  });
  if (legacyServer) {
    console.log(`Sunucu zaten var (id: ${legacyServer._id}), tekrar oluşturulmayacak.`);
  } else {
    console.log(`Sunucu oluşturulacak: "Disco" (sahip: ${ownerUser.username})`);
    if (!DRY_RUN) {
      legacyServer = await ServerModel.create({
        name: "Disco",
        ownerUsername: ownerUser.username,
        inviteCode: generateInviteCode(),
      });
    }
  }

  // Kuru çalıştırmada gerçek bir server._id olmadığı için sonraki
  // adımları sadece SAYARAK simüle ediyoruz.
  const legacyServerId = legacyServer?._id || null;

  // 3) Her env kanalı için bir Channel kaydı (yoksa oluştur).
  const channelDocByName = new Map();
  let channelsCreated = 0;
  let channelsExisting = 0;
  for (const c of CHANNELS_CONFIG) {
    if (DRY_RUN) {
      const existing = legacyServerId
        ? await Channel.findOne({ serverId: legacyServerId, name: c.name }).lean()
        : null;
      if (existing) channelsExisting += 1;
      else channelsCreated += 1;
      continue;
    }
    const channelDoc = await Channel.findOneAndUpdate(
      { serverId: legacyServerId, name: c.name },
      { $setOnInsert: { allowedRoles: c.allowedRoles } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    channelDocByName.set(c.name, channelDoc);
  }
  console.log(
    DRY_RUN
      ? `Kanal kayıtları: ${channelsCreated} yeni oluşturulacak, ${channelsExisting} zaten var.`
      : `Kanal kayıtları hazır (${CHANNELS_CONFIG.length} kanal).`
  );

  // 4) Mevcut Message/ChannelMember dokümanlarını yeni channelId'ye bağla
  //    — sadece HENÜZ bağlanmamış olanları (idempotent).
  let totalMessagesMigrated = 0;
  let totalMembersMigrated = 0;
  for (const c of CHANNELS_CONFIG) {
    const channelDoc = channelDocByName.get(c.name);
    if (DRY_RUN) {
      const msgCount = await Message.countDocuments({ channel: c.name, channelId: { $exists: false } });
      const memberCount = await ChannelMember.countDocuments({
        channel: c.name,
        channelId: { $exists: false },
      });
      totalMessagesMigrated += msgCount;
      totalMembersMigrated += memberCount;
      continue;
    }
    const msgResult = await Message.updateMany(
      { channel: c.name, channelId: { $exists: false } },
      { $set: { channelId: channelDoc._id } }
    );
    const memberResult = await ChannelMember.updateMany(
      { channel: c.name, channelId: { $exists: false } },
      { $set: { channelId: channelDoc._id } }
    );
    totalMessagesMigrated += msgResult.modifiedCount;
    totalMembersMigrated += memberResult.modifiedCount;
  }
  console.log(
    `${DRY_RUN ? "Taşınacak" : "Taşınan"} mesaj sayısı: ${totalMessagesMigrated}, kanal-üyeliği kaydı: ${totalMembersMigrated}`
  );

  // 5) Her mevcut kullanıcı için bu sunucuda bir üyelik kaydı (yoksa
  //    oluştur) — böylece kimse erişimini kaybetmiyor.
  const allUsers = await User.find({}).select("username roles").lean();
  let membersCreated = 0;
  let membersExisting = 0;
  for (const u of allUsers) {
    if (DRY_RUN) {
      const existing = legacyServerId
        ? await ServerMember.findOne({ serverId: legacyServerId, username: u.username }).lean()
        : null;
      if (existing) membersExisting += 1;
      else membersCreated += 1;
      continue;
    }
    // NOT: findOneAndUpdate + rawResult yerine basit "var mı kontrol et,
    // yoksa oluştur" — Mongoose'un yeni sürümlerinde rawResult'ın şekli
    // değişmiş olabiliyor, bu daha sade yaklaşım her sürümde güvenilir.
    const existing = await ServerMember.findOne({
      serverId: legacyServerId,
      username: u.username,
    }).lean();
    if (existing) {
      membersExisting += 1;
      continue;
    }
    await ServerMember.create({
      serverId: legacyServerId,
      username: u.username,
      isOwner: (u.roles || []).includes(ADMIN_ROLE),
    });
    membersCreated += 1;
  }
  console.log(
    DRY_RUN
      ? `Sunucu üyeliği: ${membersCreated} yeni oluşturulacak, ${membersExisting} zaten var (toplam ${allUsers.length} kullanıcı).`
      : `Sunucu üyeliği hazır: ${membersCreated} yeni, ${membersExisting} zaten vardı (toplam ${allUsers.length} kullanıcı).`
  );

  console.log(
    DRY_RUN
      ? "\n✅ Kuru çalıştırma bitti — yukarıdaki sayılar doğru görünüyorsa '--dry-run' olmadan tekrar çalıştır."
      : `\n✅ Geçiş tamamlandı. Sunucu davet kodu: ${legacyServer.inviteCode}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Geçiş sırasında hata:", err);
  process.exit(1);
});
