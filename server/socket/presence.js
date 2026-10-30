// Durum ve etkinlik olayları: durum seçimi ve özel durum (kalıcı), boşta
// ve oynanan oyun (bağlantıya ait). Değişince kişinin sunucularındakilere
// varlık listesini yenilemeleri söyleniyor.
const { User } = require("../db");
const { announceUserPresence } = require("../lib/rooms");
const { STATUSES, CUSTOM_STATUS_HOURS, CUSTOM_STATUS_MAX, ACTIVITY_MAX, activeCustomStatus } = require("../lib/presence");

module.exports = function registerPresenceHandlers(socket, ctx) {
  const announce = () => announceUserPresence(ctx.username, socket.data.serverIds || []);

  socket.on("set-status", async ({ status } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!ctx.username || !STATUSES.includes(status)) return reply({ success: false, message: "Geçersiz durum." });
    try {
      await User.updateOne({ username: ctx.username }, { status });
      reply({ success: true });
      announce();
    } catch (err) {
      console.error("Durum kaydedilirken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // text boş ya da null: özel durumu siler. expiresInHours: 1, 4, 24 ya da null.
  socket.on("set-custom-status", async ({ text, expiresInHours = null } = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!ctx.username) return reply({ success: false, message: "Önce giriş yapman gerekiyor." });
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (trimmed.length > CUSTOM_STATUS_MAX) {
      return reply({ success: false, message: `En fazla ${CUSTOM_STATUS_MAX} karakter.` });
    }
    if (!(expiresInHours === null || CUSTOM_STATUS_HOURS.includes(expiresInHours))) {
      return reply({ success: false, message: "Geçersiz süre." });
    }
    try {
      const customStatus = trimmed
        ? { text: trimmed, expiresAt: expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null }
        : null;
      await User.updateOne({ username: ctx.username }, { customStatus });
      reply({ success: true, customStatus: activeCustomStatus({ customStatus }) });
      announce();
    } catch (err) {
      console.error("Özel durum kaydedilirken hata:", err.message);
      reply({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("set-idle", ({ idle } = {}) => {
    if (!ctx.username || socket.data.idle === !!idle) return;
    socket.data.idle = !!idle;
    announce();
  });

  // Oynanan oyunun adı (masaüstü uygulaması bulur) ya da null.
  socket.on("set-activity", ({ name } = {}) => {
    if (!ctx.username) return;
    const activity = typeof name === "string" && name.trim() ? name.trim().slice(0, ACTIVITY_MAX) : null;
    if ((socket.data.activity || null) === activity) return;
    socket.data.activity = activity;
    announce();
  });
};
