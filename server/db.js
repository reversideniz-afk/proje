// ============================================================
// VERİTABANI BAĞLANTISI VE KULLANICI ŞEMASI
// ------------------------------------------------------------
// Burada sadece KİŞİSEL HESAPLAR (kullanıcı adı + hash'lenmiş şifre)
// tutuluyor. Kanal şifreleri burada DEĞİL — onlar server.js'te,
// ortam değişkenlerinden (basit, paylaşılan yapılandırma olduğu için
// tam bir veritabanı kaydı gerektirmiyor).
// ============================================================

const mongoose = require("mongoose");

// ÖNEMLİ (sağlamlık): Varsayılan olarak mongoose, bağlantı kurulana kadar
// sorguları "kuyruğa alıp" bekletir — bağlantı hiç kurulamazsa bu,
// sorgunun SONSUZA KADAR asılı kalmasına yol açabilir. Bunun yerine
// bağlı değilken sorguların HEMEN hata vermesini istiyoruz (try/catch
// ile düzgünce yakalayabilelim diye).
mongoose.set("bufferCommands", false);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  // ÖNEMLİ: Şifrenin kendisi DEĞİL, "hash"i (geri döndürülemez, tek
  // yönlü şifrelenmiş hali) saklanıyor. Veritabanına biri sızsa bile
  // eline gerçek şifreler geçmez.
  passwordHash: { type: String, required: true },
  // YENİ: Discord'daki rol mantığı gibi — her kullanıcının bir ya da
  // daha fazla etiketi (rolü) olabilir (ör. "Yönetici", "Arkadaş").
  // Kanallar artık şifreyle değil, bu rollere göre erişime açılıyor.
  roles: { type: [String], default: [] },
  // YENİ: Profil fotoğrafı — küçük bir base64 data URL olarak saklanıyor
  // (send-photo'daki geçici fotoğraflardan FARKLI olarak burası KALICI).
  // Boyutu server.js'teki 'set-avatar' işleyicisinde sınırlıyoruz ki
  // veritabanı büyük resimlerle şişmesin.
  avatarData: { type: String, default: null },
  // YENİ: Giriş denemesi sınırlama (rate limiting) — 5 yanlış şifreden
  // sonra hesap geçici kilitleniyor (bkz. server.js login işleyicisi).
  // loginLockedUntil geçmişte/null ise hesap kilitli DEĞİL. Alganis
  // rolündeki bir hesap, Üye Yönetimi panelinden bunu erken açabilir.
  failedLoginAttempts: { type: Number, default: 0 },
  loginLockedUntil: { type: Date, default: null },
});

// mongoose.models.User kontrolü: bu dosya birden fazla yerden
// (server.js ve add-user.js scripti) çağrılabiliyor, aynı modelin
// iki kere tanımlanmaya çalışılmasını önlüyor.
const User = mongoose.models.User || mongoose.model("User", userSchema);

// YENİ: Sohbet mesajları — kalıcı, hiç silinmiyor. Her kanalın kendi
// mesaj geçmişi "channel" alanına göre ayrılıyor.
const messageSchema = new mongoose.Schema({
  channel: { type: String, required: true, index: true },
  username: { type: String, required: true },
  text: { type: String, required: true, maxlength: 2000, trim: true },
  createdAt: { type: Date, default: Date.now },
  // YENİ: mesaj düzenlenmişse ne zaman düzenlendiği (arayüzde "(düzenlendi)" göstermek için).
  editedAt: { type: Date, default: null },
  // YENİ: emoji tepkileri — [{ emoji: "👍", username: "Alganis" }, ...]
  // Aynı kişi aynı emojiyi tekrar tıklarsa, o kaydı siliyoruz (aç/kapa).
  reactions: {
    type: [{ emoji: String, username: String, _id: false }],
    default: [],
  },
});
const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

// YENİ: Bir kişi bir kanala (metin olarak) katıldığında buraya kaydı
// düşüyor — "bu kanalda hiç bulunmuş biri" listesini (çevrimdışı
// üyeler) gösterebilmek için. Sesle hiç ilgisi yok, sadece "kanalı
// hiç açmış mı" bilgisini tutuyor.
const channelMemberSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  username: { type: String, required: true },
  lastSeenAt: { type: Date, default: Date.now },
});
channelMemberSchema.index({ channel: 1, username: 1 }, { unique: true });
const ChannelMember =
  mongoose.models.ChannelMember || mongoose.model("ChannelMember", channelMemberSchema);

// YENİ: Kayıt (register) uç noktasına karşı saldırı niteliğinde (kısa
// sürede çok sayıda yanlış davet kodu deneyen) bir IP adresi KALICI
// olarak buraya kaydediliyor — sunucu yeniden başlasa bile ban devam
// etsin diye (bkz. server.js — banlıIpSet, açılışta buradan doldurulur).
const bannedIpSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  reason: { type: String, default: "" },
  attemptCount: { type: Number, default: 0 },
  bannedAt: { type: Date, default: Date.now },
});
const BannedIp = mongoose.models.BannedIp || mongoose.model("BannedIp", bannedIpSchema);

// YENİ: "Beni hatırla" — kullanıcı bunu işaretlerse, giriş belirteci
// (token) burada KALICI olarak saklanıyor (server.js'teki bellek-içi
// sessionTokens haritası sunucu yeniden başlayınca sıfırlanır, bu ise
// kalır). expiresAt geçmişse token artık geçersiz sayılıyor — her
// başarılı "resume-session" isteğinde süre yenileniyor (kayan pencere).
const sessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn(
      "UYARI: MONGODB_URI ortam değişkeni ayarlanmamış — giriş sistemi çalışmayacak."
    );
    return false;
  }
  await mongoose.connect(uri);
  console.log("MongoDB bağlantısı kuruldu.");
  return true;
}

module.exports = { connectDB, User, Message, ChannelMember, BannedIp, Session };
