// ============================================================
// HESAP EKLEME / ŞİFRE DEĞİŞTİRME / ROL ATAMA SCRİPTİ
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
// YENİ: Üçüncü (opsiyonel) bir parametre olarak, virgülle ayrılmış
// ROLLER de verebilirsin — bu kişinin hangi kanallara girebileceğini
// belirler (kanalların hangi rolleri kabul ettiği Render'daki
// CHANNEL_N_ROLES ile ayarlanıyor). Roller belirtmezsen: yeni
// kullanıcı roleri boş başlar, VAR OLAN kullanıcının rolleri
// DOKUNULMADAN kalır (yanlışlıkla silinmesin diye).
//
// KULLANIM:
//   1) Bu klasörde bir ".env" dosyası oluştur (yoksa), içine:
//        MONGODB_URI=mongodb+srv://...
//      yaz (Render'a eklediğin AYNI bağlantı metni).
//   2) Terminalde: node add-user.js <kullanıcı-adı> <şifre> [roller]
//      Örnek:      node add-user.js kazim gizliSifre123 Arkadaş,Yönetici
// ============================================================

require("dotenv").config();
const { connectDB, User } = require("./db");
const bcrypt = require("bcryptjs");

const [, , username, password, rolesArg] = process.argv;

if (!username || !password) {
  console.error("Kullanım: node add-user.js <kullanıcı-adı> <şifre> [roller (virgülle ayrılmış)]");
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
  const roles = rolesArg
    ? rolesArg.split(",").map((r) => r.trim()).filter(Boolean)
    : undefined;

  if (existing) {
    existing.passwordHash = passwordHash;
    if (roles !== undefined) existing.roles = roles;
    await existing.save();
    console.log(
      `🔄 "${username}" zaten vardı — şifresi güncellendi.` +
        (roles !== undefined ? ` Roller: [${roles.join(", ")}]` : " Roller değiştirilmedi.")
    );
  } else {
    await User.create({ username, passwordHash, roles: roles || [] });
    console.log(
      `✅ Kullanıcı "${username}" başarıyla eklendi. Roller: [${(roles || []).join(", ")}]`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Hata:", err.message);
  process.exit(1);
});
