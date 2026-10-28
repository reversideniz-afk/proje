// Profil fotoğrafları adresle veriliyor: üye listesinde ve seste sadece
// kısa bir adres gidiyor, resmin kendisini tarayıcı bir kez indirip
// önbellekte tutuyor. Eskiden her katılma/ayrılmada herkesin base64
// avatarı herkese yeniden gönderiliyordu (H26).
const { User } = require("../db");

// Sadece bu biçimler kabul edilip sunuluyor. SVG bilerek yok: sunucunun
// kendi adresinden açılan bir SVG içindeki betik, web sürümünde oturum
// anahtarına erişebilirdi.
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function avatarVersion(updatedAt) {
  return updatedAt ? new Date(updatedAt).getTime().toString(36) : "0";
}

// Adresteki sürüm resim değiştikçe değişiyor; tarayıcı aynı adresi bir daha
// sormuyor, yeni resim yeni adresle geliyor.
function avatarUrl(username, updatedAt) {
  return `/api/avatars/${encodeURIComponent(username)}?v=${avatarVersion(updatedAt)}`;
}

// Kullanıcı adı -> avatar adresi; fotoğrafı olmayanlar haritada yok. Resmin
// kendisi veritabanından çekilmiyor, sadece var olup olmadığı.
async function avatarUrlsFor(usernames) {
  if (usernames.length === 0) return new Map();
  const rows = await User.aggregate([
    { $match: { username: { $in: usernames } } },
    {
      $project: {
        username: 1,
        avatarUpdatedAt: 1,
        hasAvatar: { $gt: ["$avatarData", null] },
      },
    },
  ]);
  return new Map(
    rows.filter((r) => r.hasAvatar).map((r) => [r.username, avatarUrl(r.username, r.avatarUpdatedAt)])
  );
}

async function avatarUrlOf(username) {
  return (await avatarUrlsFor([username])).get(username) || null;
}

module.exports = { AVATAR_TYPES, avatarVersion, avatarUrl, avatarUrlsFor, avatarUrlOf };
