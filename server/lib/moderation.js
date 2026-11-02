// Sunucu moderasyonu: susturma (timeout) ve yasaklama. Susturulan kişi
// süre bitene kadar o sunucunun kanallarında yazamıyor (mesaj, fotoğraf,
// tepki, anket, etkinlik) ve sese giremiyor; özel mesajlar etkilenmiyor.
// Yasaklanan çıkarılıyor ve davetle geri giremiyor.
const { ServerMember, ServerBan } = require("../db");

// Seçilebilen susturma süreleri (dakika): 5 dakika, 1 saat, 1 gün, 1 hafta.
const TIMEOUT_MINUTES = [5, 60, 24 * 60, 7 * 24 * 60];

const TIMEOUT_MESSAGE = "Bu sunucuda susturuldun; süre bitene kadar yazamaz ve sese giremezsin.";

// Kişinin o sunucudaki susturmasının bitişi ya da null (susturulmamış,
// süresi geçmiş ya da özel mesaj).
async function activeTimeout(serverId, username) {
  if (!serverId || !username) return null;
  const member = await ServerMember.findOne({ serverId, username }).select("timeoutUntil").lean();
  return member?.timeoutUntil && member.timeoutUntil > new Date() ? member.timeoutUntil : null;
}

async function isBanned(serverId, username) {
  return !!(await ServerBan.exists({ serverId, username }));
}

// Yanıt beklemeyen yazma olayları için (mesaj, düzenleme, tepki): kişi bu
// sunucuda susturulmuşsa sohbetine uyarı gidiyor ve true dönüyor.
async function blockedByTimeout(socket, serverId, username) {
  if (!(await activeTimeout(serverId, username))) return false;
  socket.emit("new-message", { username: "Sistem", system: true, text: TIMEOUT_MESSAGE, createdAt: new Date() });
  return true;
}

module.exports = { TIMEOUT_MINUTES, TIMEOUT_MESSAGE, activeTimeout, isBanned, blockedByTimeout };
