// Birlikte izleme: bir ses odasında aynı YouTube videosunu herkes aynı anda
// izliyor. Sunucu sadece ortak durumu tutuyor (hangi video, oynuyor mu,
// hangi saniyede, ne zaman); oynatıcılar istemcilerde ve bu duruma göre
// kendilerini ayarlıyor. Odada kimse kalmayınca oturum bitiyor.
const watchSessions = new Map(); // ses odası (kanal kimliği) -> oturum

const VIDEO_ID = /^[\w-]{11}$/;
const MAX_POSITION = 24 * 60 * 60;

// Şu anki konum: oynuyorsa son değişiklikten beri geçen süre ekleniyor.
function currentPosition(session, now = Date.now()) {
  if (!session.playing) return session.position;
  return Math.min(MAX_POSITION, session.position + (now - session.updatedAt) / 1000);
}

// İstemciye giden biçim; serverNow ile istemci kendi saatinin farkını
// hesaplıyor.
function serializeWatch(roomId, extra = {}) {
  const session = watchSessions.get(roomId);
  if (!session) return { session: null, serverNow: Date.now(), ...extra };
  return {
    session: {
      videoId: session.videoId,
      title: session.title,
      startedBy: session.startedBy,
      playing: session.playing,
      position: session.position,
      updatedAt: session.updatedAt,
    },
    serverNow: Date.now(),
    ...extra,
  };
}

function clearWatch(roomId) {
  return watchSessions.delete(roomId);
}

module.exports = { watchSessions, currentPosition, serializeWatch, clearWatch, VIDEO_ID, MAX_POSITION };
