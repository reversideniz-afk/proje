// Platform yöneticisi (Alganis rolü): kullanıcılar, roller, giriş kilitleri,
// IP banları.
const { User, BannedIp } = require("../db");
const { ADMIN_ROLE } = require("../lib/access");
const { registerAttemptsByIp, bannedIpSet } = require("../lib/limits");
const { recheckUserAccess } = require("../lib/rooms");

module.exports = function registerAdminHandlers(socket, ctx) {
  // ---- YENİ: Uygulama içi rol yönetimi — SADECE ADMIN_ROLE rolüne sahip
  // hesaplar kullanabilir. Kayıtlı TÜM kullanıcıları (rolleriyle birlikte)
  // döndürüyor — bir kanalı hiç açmamış olsalar bile (offline üye listesi
  // sadece o kanalı en az bir kere açmış kişileri gösteriyordu, bu ondan
  // bağımsız ve tam liste).
  socket.on("list-all-users", async ({ token }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const users = await User.find({})
        .select("username roles loginLockedUntil")
        .sort({ username: 1 })
        .lean();
      const now = new Date();
      callback({
        success: true,
        users: users.map((u) => ({
          username: u.username,
          roles: u.roles || [],
          // YENİ: Üye Yönetimi'nde kilitli hesapları gösterip erken
          // açabilmek için (bkz. unlock-user-login).
          isLoginLocked: !!(u.loginLockedUntil && u.loginLockedUntil > now),
        })),
      });
    } catch (err) {
      console.error("Kullanıcı listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir kullanıcıya rol ekleme/çıkarma — SADECE ADMIN_ROLE. ----
  socket.on("update-user-role", async ({ token, targetUsername, role, action }) => {
    const username = await ctx.authenticate(token);
    if (
      !username ||
      typeof targetUsername !== "string" ||
      typeof role !== "string" ||
      !role.trim() ||
      (action !== "add" && action !== "remove")
    ) {
      return;
    }
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Bu işlemi yapma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }
      const roleTrimmed = role.trim();
      const update =
        action === "add" ? { $addToSet: { roles: roleTrimmed } } : { $pull: { roles: roleTrimmed } };
      const updated = await User.findOneAndUpdate({ username: targetUsername }, update, {
        new: true,
      }).lean();
      if (!updated) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Kullanıcı bulunamadı.",
          createdAt: new Date(),
        });
        return;
      }
      socket.emit("user-role-updated", { username: targetUsername, roles: updated.roles || [] });
      // Rolü alınan kişi kısıtlı bir kanaldaysa oradan çıkarılıyor.
      if (action === "remove") {
        await recheckUserAccess(targetUsername, "Bu kanala erişim yetkin kalmadı.", {
          listChanged: true,
        });
      }
    } catch (err) {
      console.error("Rol güncellenirken hata:", err.message);
    }
  });

  // ---- YENİ: Kilitli bir hesabın girişini erken açma — SADECE
  // ADMIN_ROLE. 5 yanlış şifreden sonra otomatik kilitlenen hesaplar
  // için (bkz. login işleyicisi) — "istediğim zaman kaldırabileyim".
  socket.on("unlock-user-login", async ({ token, targetUsername }) => {
    const username = await ctx.authenticate(token);
    if (!username || typeof targetUsername !== "string" || !targetUsername.trim()) return;
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Bu işlemi yapma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }
      await User.updateOne(
        { username: targetUsername.trim() },
        { failedLoginAttempts: 0, loginLockedUntil: null }
      );
      socket.emit("user-login-unlocked", { username: targetUsername.trim() });
    } catch (err) {
      console.error("Giriş kilidi açılırken hata:", err.message);
    }
  });

  // ---- YENİ: Banlı IP listesi — SADECE ADMIN_ROLE. ----
  socket.on("list-banned-ips", async ({ token }, callback) => {
    const username = await ctx.authenticate(token);
    if (typeof callback !== "function") return;
    if (!username) return callback({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        return callback({ success: false, message: "Bu işlemi yapma yetkin yok." });
      }
      const banned = await BannedIp.find({}).sort({ bannedAt: -1 }).lean();
      callback({
        success: true,
        bannedIps: banned.map((b) => ({
          ip: b.ip,
          reason: b.reason,
          attemptCount: b.attemptCount,
          bannedAt: b.bannedAt,
        })),
      });
    } catch (err) {
      console.error("Banlı IP listesi alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Bir IP'nin banını kaldırma — SADECE ADMIN_ROLE. Yanlışlıkla
  // (ör. bir arkadaşın art arda yanlış davet kodu denemesi) banlanan
  // birini kurtarabilmek için. ----
  socket.on("unban-ip", async ({ token, ip }) => {
    const username = await ctx.authenticate(token);
    if (!username || typeof ip !== "string" || !ip.trim()) return;
    try {
      const requester = await User.findOne({ username }).lean();
      if (!(requester?.roles || []).includes(ADMIN_ROLE)) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Bu işlemi yapma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }
      bannedIpSet.delete(ip.trim());
      registerAttemptsByIp.delete(ip.trim());
      await BannedIp.deleteOne({ ip: ip.trim() });
      socket.emit("ip-unbanned", { ip: ip.trim() });
    } catch (err) {
      console.error("IP banı kaldırılırken hata:", err.message);
    }
  });
};
