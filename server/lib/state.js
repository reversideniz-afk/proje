// Bellekteki anlık durum: kim hangi metin kanalında, kim hangi seste, hangi
// kullanıcının hangi bağlantıları açık; oda adları.

 // ip -> banlı mı (hızlı kontrol için, DB'den yükleniyor)

// YENİ: "şu an bağlı olan X kullanıcısının soketleri hangileri" — bir IP
// banlandığında Alganis rolündeki BAĞLI hesaplara ANLIK uyarı
// gönderebilmek için (bkz. notifyAdmins).
const socketsByUsername = new Map();

// ------------------------------------------------------------
// DURUM (bellekte tutuluyor)
// textRooms["Kanal"]  = { socketId: { username } }              — metin kanalında kim var
// voiceRooms["Kanal"] = { socketId: { username, muted, ... } }  — seste kim var (textRooms'un alt kümesi)
// ------------------------------------------------------------
const textRooms = {};

const voiceRooms = {};

function textRoomName(channel) {
  return `text:${channel}`;
}

function voiceRoomName(channel) {
  return `voice:${channel}`;
}

function serverRoomName(serverId) {
  return `server:${serverId}`;
}

module.exports = { socketsByUsername, textRooms, voiceRooms, textRoomName, voiceRoomName, serverRoomName };
