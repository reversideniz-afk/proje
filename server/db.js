// ============================================================
// VERİTABANI BAĞLANTISI VE KULLANICI ŞEMASI
// ------------------------------------------------------------
// Burada sadece KİŞİSEL HESAPLAR (kullanıcı adı + hash'lenmiş şifre)
// tutuluyor. Kanal şifreleri burada DEĞİL — onlar server.js'te,
// ortam değişkenlerinden (basit, paylaşılan yapılandırma olduğu için
// tam bir veritabanı kaydı gerektirmiyor).
// ============================================================

const mongoose = require("mongoose");

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

module.exports = { connectDB, User };
