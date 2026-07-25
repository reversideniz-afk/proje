// ============================================================
// HESAP EKLEME SCRİPTİ
// ------------------------------------------------------------
// Bu, herkesin kullandığı bir şey DEĞİL — sadece SEN, kendi
// bilgisayarında, yeni bir arkadaşına hesap açmak istediğinde
// çalıştırıyorsun. Uygulamanın kendisinde "kayıt ol" ekranı YOK,
// bilerek — herkese açık bir kayıt formu güvenlik açığı olurdu.
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

  const existing = await User.findOne({ username });
  if (existing) {
    console.error(`"${username}" adında bir kullanıcı zaten var.`);
    process.exit(1);
  }

  // 10 = "salt round" sayısı — bcrypt'in standart, güvenli varsayılanı.
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ username, passwordHash });

  console.log(`✅ Kullanıcı "${username}" başarıyla eklendi.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Hata:", err.message);
  process.exit(1);
});
