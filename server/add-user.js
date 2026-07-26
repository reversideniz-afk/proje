// ============================================================
// HESAP EKLEME / ŞİFRE DEĞİŞTİRME SCRİPTİ
// ------------------------------------------------------------
// Bu, herkesin kullandığı bir şey DEĞİL — sadece SEN, kendi
// bilgisayarında çalıştırıyorsun. Uygulamanın kendisinde "kayıt ol"
// ekranı YOK, bilerek — herkese açık bir kayıt formu güvenlik açığı
// olurdu.
//
// AYNI KOMUT hem yeni hesap açar HEM de var olan birinin şifresini
// değiştirir — kullanıcı adı zaten VARSA şifresini günceller, YOKSA
// yeni hesap oluşturur. Kendi şifreni değiştirmek istersen de aynı
// komutu kendi kullanıcı adınla çalıştırman yeterli.
//
// KULLANIM:
//   1) Bu klasörde bir ".env" dosyası oluştur (yoksa), içine:
//        MONGODB_URI=mongodb+srv://...
//      yaz (Render'a eklediğin AYNI bağlantı metni).
//   2) Terminalde: node add-user.js <kullanıcı-adı> <şifre>
//      Örnek:      node add-user.js kazim gizliSifre123
// ============================================================

require("dotenv").config();
const { connectDB, User } = require("./db");
const bcrypt = require("bcryptjs");

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Kullanım: node add-user.js <kullanıcı-adı> <şifre>");
  process.exit(1);
}

async function main() {
  const connected = await connectDB();
  if (!connected) {
    console.error(
      "MONGODB_URI ayarlı değil. Bu klasörde bir .env dosyası oluşturup içine ekle."
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ username });

  if (existing) {
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log(`🔄 "${username}" zaten vardı — şifresi güncellendi.`);
  } else {
    await User.create({ username, passwordHash });
    console.log(`✅ Kullanıcı "${username}" başarıyla eklendi.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Hata:", err.message);
  process.exit(1);
});
