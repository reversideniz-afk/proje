// Durum ve etkinlik. Kişinin seçtiği durum (User.status) ve özel durumu
// (User.customStatus) veritabanında; "boşta" ve oynanan oyun bağlantıya ait
// (socket.data.idle / socket.data.activity), uygulama kapanınca gidiyor.
// İstemci (desktop/src/lib/presence.js) aynı durumları gösteriyor.

const STATUSES = ["online", "idle", "dnd", "invisible"];
const CUSTOM_STATUS_HOURS = [1, 4, 24]; // null: süresiz
const CUSTOM_STATUS_MAX = 80;
const ACTIVITY_MAX = 64;

// Süresi dolmamış özel durum ya da null.
function activeCustomStatus(user, now = new Date()) {
  const custom = user?.customStatus;
  if (!custom?.text) return null;
  if (custom.expiresAt && new Date(custom.expiresAt) <= now) return null;
  return { text: custom.text, expiresAt: custom.expiresAt || null };
}

// Başkalarının gördüğü hâl. sockets: kişinin açık bağlantıları (yoksa
// çevrimdışı). Görünmez seçen çevrimdışı görünüyor; özel durumu ve oyunu da
// gizli. "Çevrimiçi" seçip bütün bağlantıları boşta olan "boşta" görünüyor.
function visiblePresence(user, sockets) {
  const status = STATUSES.includes(user?.status) ? user.status : "online";
  if (!sockets?.size || status === "invisible") {
    return { online: false, status: "offline", customStatus: null, activity: null };
  }
  const all = [...sockets];
  const idle = all.every((s) => s.data.idle);
  return {
    online: true,
    status: status === "online" && idle ? "idle" : status,
    customStatus: activeCustomStatus(user)?.text || null,
    activity: all.map((s) => s.data.activity).find(Boolean) || null,
  };
}

module.exports = { STATUSES, CUSTOM_STATUS_HOURS, CUSTOM_STATUS_MAX, ACTIVITY_MAX, activeCustomStatus, visiblePresence };
