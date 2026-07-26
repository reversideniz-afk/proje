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

module.exports = { connectDB, User, Message, ChannelMember };
