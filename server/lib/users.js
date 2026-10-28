// Kullanıcı adı kuralları: büyük/küçük harfe duyarsız arama ve alınamayan adlar.
const { User } = require("../db");

// Kullanıcı adları büyük/küçük harfe duyarsız karşılaştırılıyor: "alganis"
// ile "Alganis" aynı hesap (H11). Türkçede I/ı ve İ/i ayrı harf çiftleri
// olduğu için hem Türkçe hem İngilizce kurallarla bakılıyor; ikisinden
// birine göre aynıysa aynı ad sayılıyor ("ALGANIS" de "Alganis"e takılır).
const USERNAME_COLLATIONS = [
  { locale: "tr", strength: 2 },
  { locale: "en", strength: 2 },
];

// Ada benzeyen kayıtlı kullanıcılar (birebir eşleşen başta).
async function findUsersByName(name) {
  const found = new Map();
  for (const collation of USERNAME_COLLATIONS) {
    const users = await User.find({ username: name }).collation(collation).limit(5);
    users.forEach((u) => found.set(u.username, u));
  }
  return [...found.values()].sort((a, b) => (b.username === name) - (a.username === name));
}

// Hesap adı olarak alınamayan adlar: sunucunun kendi mesajları "Sistem"
// adıyla gidiyor (bu adı alan biri sahte sistem uyarısı yazabilirdi), "all"
// ise @all bahsetmesi.
const RESERVED_USERNAMES = ["sistem", "system", "all", "everyone", "here", "admin", "yönetici", "disco"];

function isReservedUsername(name) {
  return [name.toLowerCase(), name.toLocaleLowerCase("tr")].some((lower) =>
    RESERVED_USERNAMES.includes(lower)
  );
}

module.exports = { USERNAME_COLLATIONS, findUsersByName, RESERVED_USERNAMES, isReservedUsername };
