// Birlikte izleme olayları (bkz. lib/watch.js). Sadece o seste olanlar
// başlatıp yönetebiliyor; değişiklik odadaki herkese "watch-state" ile
// gidiyor (kim, ne yaptı da içinde).
const { io } = require("../lib/realtime");
const { voiceRoomName } = require("../lib/state");
const { LinkImage } = require("../db");
const { previewFor } = require("../lib/linkPreview");
const { watchSessions, currentPosition, serializeWatch, VIDEO_ID, MAX_POSITION } = require("../lib/watch");

module.exports = function registerWatchHandlers(socket, ctx) {
  const inVoice = () => !!ctx.username && !!ctx.voiceRoom;
  const broadcast = (roomId, by, action) => io.to(voiceRoomName(roomId)).emit("watch-state", serializeWatch(roomId, { by, action }));

  socket.on("watch-start", ({ videoId, title } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!inVoice()) return reply({ success: false, message: "Önce sese katıl." });
    if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) {
      return reply({ success: false, message: "Geçerli bir YouTube bağlantısı değil." });
    }
    watchSessions.set(ctx.voiceRoom, {
      videoId,
      title: typeof title === "string" ? title.trim().slice(0, 200) || null : null,
      startedBy: ctx.username,
      playing: true,
      position: 0,
      updatedAt: Date.now(),
    });
    broadcast(ctx.voiceRoom, ctx.username, "start");
    reply({ success: true });

    // Başlık verilmediyse (bağlantı penceresinden) YouTube'dan bulunuyor.
    const session = watchSessions.get(ctx.voiceRoom);
    const roomId = ctx.voiceRoom;
    if (!session.title) {
      previewFor(`https://www.youtube.com/watch?v=${videoId}`, LinkImage).then((preview) => {
        if (!preview?.title || watchSessions.get(roomId) !== session) return;
        session.title = preview.title;
        io.to(voiceRoomName(roomId)).emit("watch-state", serializeWatch(roomId, { action: "title" }));
      });
    }
  });

  // action: play | pause | seek. position: saniye (seek'te zorunlu, play ve
  // pause'da verilirse oradan devam ediliyor).
  socket.on("watch-control", ({ action, position } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!inVoice()) return reply({ success: false, message: "Önce sese katıl." });
    const session = watchSessions.get(ctx.voiceRoom);
    if (!session) return reply({ success: false, message: "Şu an birlikte izlenen bir video yok." });
    if (!["play", "pause", "seek"].includes(action)) return reply({ success: false, message: "Geçersiz işlem." });
    const hasPosition = typeof position === "number" && Number.isFinite(position);
    if (action === "seek" && !hasPosition) return reply({ success: false, message: "Geçersiz konum." });
    const now = Date.now();
    session.position = hasPosition ? Math.max(0, Math.min(MAX_POSITION, position)) : currentPosition(session, now);
    if (action === "play") session.playing = true;
    if (action === "pause") session.playing = false;
    session.updatedAt = now;
    broadcast(ctx.voiceRoom, ctx.username, action);
    reply({ success: true });
  });

  socket.on("watch-stop", (_payload, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!inVoice()) return reply({ success: false, message: "Önce sese katıl." });
    if (!watchSessions.delete(ctx.voiceRoom)) return reply({ success: true });
    broadcast(ctx.voiceRoom, ctx.username, "stop");
    reply({ success: true });
  });
};
