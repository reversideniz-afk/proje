// ============================================================
// SİNYALLEŞME SUNUCUSU (Signaling Server)
// ------------------------------------------------------------
// Bu sunucu SES/GÖRÜNTÜ VERİSİ TAŞIMIYOR. Sadece kullanıcıların
// birbirini bulmasını ve WebRTC bağlantı kurma mesajlarını
// (offer/answer/ice candidate) karşı tarafa iletmeyi sağlıyor.
// Gerçek ses/görüntü/ekran akışı, bağlantı kurulduktan sonra
// doğrudan cihazlar arasında (peer-to-peer) gidiyor.
//
// YENİ MİMARİ: Artık "metin kanalına girmek" ile "sese girmek" AYRI
// iki eylem. Biri metin kanalına girince sadece sohbeti/üye listesini
// görür, WebRTC bağlantısı HİÇ kurulmaz — "sese katıl" butonuna
// basınca ayrıca ses/görüntü bağlantıları kurulur.
// ============================================================

const { connectDB, BannedIp } = require("./db");
const { bannedIpSet } = require("./lib/limits");
const { httpServer } = require("./lib/realtime");

// Uygulamanın parçaları: HTTP yolları ve Socket.IO bağlantıları. Ayrıntılar
// lib/, http/ ve socket/ klasörlerinde.
require("./lib/ice");
require("./http/routes");
require("./socket/connection");

// YENİ (sağlamlık): Kodda gözden kaçan bir hata olsa bile (ör. beklenmedik
// bir veri tipi), sunucunun TÜMDEN çökmesini istemiyoruz — herkesin
// bağlantısı bir kişinin hatası yüzünden kesilmesin. Hatayı loglayıp
// sunucuyu ayakta tutuyoruz.
process.on("uncaughtException", (err) => {
  console.error("YAKALANMAMIŞ HATA (sunucu ayakta kalıyor):", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("YAKALANMAMIŞ PROMISE HATASI (sunucu ayakta kalıyor):", reason);
});

const PORT = process.env.PORT || 3001;

// Veritabanına bağlan (kişisel hesaplar için).
connectDB().then((connected) => {
  if (!connected) return;
  // YENİ: daha önce kalıcı banlanmış IP'leri belleğe yükle — sunucu
  // yeniden başlasa bile banlar geçerliliğini korusun diye.
  BannedIp.find({})
    .select("ip")
    .lean()
    .then((rows) => {
      rows.forEach((r) => bannedIpSet.add(r.ip));
      console.log(`${rows.length} banlı IP belleğe yüklendi.`);
    })
    .catch((err) => console.error("Banlı IP'ler yüklenirken hata:", err.message));
});

httpServer.listen(PORT, () => {
  console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor.`);
});
