// Odalara yayınlanan bilgiler: üye listeleri, varlık (kim çevrimiçi, kim
// seste), ses odasından çıkarma, fotoğraf iletme, erişim yeniden kontrolü.
const { User, ChannelMember, ServerMember } = require("../db");
const { ADMIN_ROLE } = require("./access");
const { avatarUrlsFor } = require("./avatars");
const { io } = require("./realtime");
const { socketsByUsername, textRooms, voiceRooms, textRoomName, voiceRoomName, serverRoomName } = require("./state");

// YENİ: Alganis rolündeki, ŞU AN bağlı olan hesaplara anlık güvenlik
// uyarısı gönderiyor (ör. bir IP kalıcı banlandığında). Kimse bağlı
// değilse sessizce hiçbir şey yapmaz — banlar zaten kalıcı olarak
// kaydediliyor, "Üye Yönetimi" > "Güvenlik" bölümünden her zaman
// görülebilir.
async function notifyAdmins(event, payload) {
  try {
    const admins = await User.find({ roles: ADMIN_ROLE }).select("username").lean();
    admins.forEach(({ username }) => {
      const sockets = socketsByUsername.get(username);
      sockets?.forEach((s) => s.emit(event, payload));
    });
  } catch (err) {
    console.error("Adminlere bildirim gönderilirken hata:", err.message);
  }
}

// Fotoğrafı kanaldakilere iletir (hiçbir yere kaydetmeden). Kanalda
// gönderenden başka kimse yoksa gönderene haber verir.
function relayPhoto(channelId, username, imageData, mimeType, senderSocketIds) {
  io.to(textRoomName(channelId)).emit("new-photo", {
    username,
    imageData,
    mimeType,
    createdAt: new Date(),
  });
  io.to(`member-notify:${channelId}`).except(senderSocketIds).emit("channel-activity", { channelId });
  const others = Object.values(textRooms[channelId] || {}).filter((u) => u.username !== username);
  if (others.length === 0) {
    io.to(senderSocketIds).emit("new-message", {
      username: "Sistem",
      system: true,
      text: "Şu an kanalda başka kimse yoktu, fotoğrafı kimse görmedi.",
      createdAt: new Date(),
    });
  }
}

// Kullanıcının bütün açık bağlantılarının sunucu odalarını yeniler (yeni
// sunucuya katılınca ya da sunucu açınca).
async function refreshUserServerRooms(username) {
  for (const s of socketsByUsername.get(username) || []) await s.data.refreshServerRooms?.();
}

// Bir kullanıcının bütün açık bağlantılarının erişimini yeniden kontrol
// eder (bkz. socket.data.recheckAccess). listChanged: sunucu listesi de
// değişti (atıldı, sunucu silindi), istemci listeyi yenilesin.
async function recheckUserAccess(username, message, { listChanged = false } = {}) {
  for (const s of socketsByUsername.get(username) || []) {
    if (listChanged) s.emit("server-list-changed");
    await s.data.recheckAccess?.(message);
  }
}

// ------------------------------------------------------------
// Kişi başına çevrimiçi bilgisi (varlık): bir sunucunun üyelerinden kim
// çevrimiçi (herhangi bir yerden bağlı) ve kim hangi kanalın sesinde.
// Eskiden "çevrimiçi" sadece o kanalı o an açık tutmak demekti.
// ------------------------------------------------------------
async function buildServerPresence(serverId) {
  const voiceChannelByUser = new Map();
  for (const [roomId, room] of Object.entries(voiceRooms)) {
    for (const info of Object.values(room)) {
      if (info.serverId === serverId) voiceChannelByUser.set(info.username, roomId);
    }
  }
  const members = await ServerMember.find({ serverId }).select("username").lean();
  // Üye olmadan erişen platform yöneticisi seste olabilir; o da görünsün.
  const usernames = [...new Set([...members.map((m) => m.username), ...voiceChannelByUser.keys()])];
  const avatarUrls = await avatarUrlsFor(usernames);
  return usernames.map((username) => ({
    username,
    online: socketsByUsername.has(username),
    voiceChannelId: voiceChannelByUser.get(username) || null,
    avatarUrl: avatarUrls.get(username) || null,
  }));
}

// Varlık değişti (biri çevrimiçi oldu ya da çıktı, sese girdi ya da
// çıktı): o sunuculardaki herkes güncel listeyi istesin.
function announcePresence(serverIds) {
  for (const serverId of new Set(serverIds)) {
    io.to(serverRoomName(serverId)).emit("presence-changed", { serverId });
  }
}

// Bir bağlantıyı ses odasından çıkarıp odadakilere haber veriyor. Bağlantı
// gerçekten odadaysa true döner; böylece aynı ayrılma iki kez duyurulmuyor.
function removeVoiceMember(roomId, socketId) {
  const room = voiceRooms[roomId];
  if (!room?.[socketId]) return false;
  const { serverId } = room[socketId];
  delete room[socketId];
  if (serverId) announcePresence([serverId]);
  if (Object.keys(room).length === 0) delete voiceRooms[roomId];
  io.to(voiceRoomName(roomId)).except(socketId).emit("voice-user-left", { socketId });
  io.sockets.sockets.get(socketId)?.leave(voiceRoomName(roomId));
  return true;
}

async function buildMemberList(channelId) {
  // Kanalda "çevrimiçi": kanalı o an açık tutan ya da kanalın sesinde olan
  // herkes (sesteyken başka bir kanala bakan da sesin olduğu kanalda
  // görünmeye devam ediyor). Liste kişi başına: iki cihazdan bağlanan biri
  // iki kez görünmüyor.
  const voiceUsernames = new Set(
    Object.values(voiceRooms[channelId] || {}).map((v) => v.username)
  );
  const onlineUsernames = new Set([
    ...Object.values(textRooms[channelId] || {}).map((u) => u.username),
    ...voiceUsernames,
  ]);
  const online = [...onlineUsernames].map((username) => ({
    username,
    inVoice: voiceUsernames.has(username),
  }));

  let offline = [];
  try {
    const allMembers = await ChannelMember.find({ channelId }).lean();
    offline = allMembers
      .filter((m) => !onlineUsernames.has(m.username))
      .map((m) => ({ username: m.username, lastSeenAt: m.lastSeenAt }));
  } catch (err) {
    console.error("Üye listesi alınırken hata:", err.message);
  }

  // Profil fotoğraflarının adresleri tek sorguda (resimlerin kendisi değil).
  try {
    const avatarUrls = await avatarUrlsFor([...onlineUsernames, ...offline.map((m) => m.username)]);
    for (const m of [...online, ...offline]) m.avatarUrl = avatarUrls.get(m.username) || null;
  } catch (err) {
    console.error("Profil fotoğrafları alınırken hata:", err.message);
  }

  return { online, offline };
}

module.exports = { notifyAdmins, relayPhoto, refreshUserServerRooms, recheckUserAccess, buildServerPresence, announcePresence, removeVoiceMember, buildMemberList };
