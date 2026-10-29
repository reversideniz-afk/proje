// Sunucuya özel roller ve kanal yönetimi: rollerin listesi, oluşturma,
// düzenleme, silme, sıralama, üyeye rol verme (sunucu sahibi); kanalın
// adını ve kimlerin göreceğini değiştirme, kanal silme (Kanalları yönet).
const mongoose = require("mongoose");
const { User, Message, ChannelMember, ServerMember, Channel, Role } = require("../db");
const { canAccessServer, requireServerPermission } = require("../lib/access");
const { io } = require("../lib/realtime");
const { recheckUserAccess } = require("../lib/rooms");
const { MAX_ROLES, cleanPermissions, validateRoleInput, serializeRole } = require("../lib/roles");
const { serverRoomName } = require("../lib/state");

const isObjectId = (id) => typeof id === "string" && mongoose.isValidObjectId(id);

// Kanal erişimi değişti: sunucudaki herkesin bağlantısı erişimini yeniden
// denetlesin (görmemesi gereken kanaldan ve sesinden çıkarılır), sonra
// listeler yenilensin.
async function afterAccessChange(serverId, message, events) {
  const room = serverRoomName(serverId.toString());
  for (const id of [...(io.sockets.adapter.rooms.get(room) || [])]) {
    await io.sockets.sockets.get(id)?.data.recheckAccess?.(message);
  }
  for (const event of events) io.to(room).emit(event, { serverId: serverId.toString() });
}

// Gönderilen rol kimlikleri bu sunucunun rolleri mi? Geçerliyse ObjectId listesi.
async function serverRoleIds(serverId, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length > MAX_ROLES || !roleIds.every(isObjectId)) return null;
  const unique = [...new Set(roleIds)];
  const count = await Role.countDocuments({ serverId, _id: { $in: unique } });
  return count === unique.length ? unique.map((id) => new mongoose.Types.ObjectId(id)) : null;
}

module.exports = function registerRoleHandlers(socket, ctx) {
  // Sunucunun rolleri, sırasıyla (üyeler adların rengi ve üye listesi için).
  socket.on("server-roles", async ({ serverId } = {}, callback) => {
    if (typeof callback !== "function") return;
    if (!ctx.username || !isObjectId(serverId)) return callback({ success: false, message: "Eksik bilgi." });
    try {
      const user = await User.findOne({ username: ctx.username }).select("roles").lean();
      if (!(await canAccessServer(ctx.username, user?.roles || [], serverId))) {
        return callback({ success: false, message: "Bu sunucuya erişimin yok." });
      }
      const roles = await Role.find({ serverId }).sort({ position: 1, createdAt: 1 }).lean();
      callback({ success: true, roles: roles.map(serializeRole) });
    } catch (err) {
      console.error("Roller alınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("create-role", async ({ serverId, name, color = null, hoist = false, permissions } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return callback({ success: false, message: error });
      const invalid = validateRoleInput({ name, color });
      if (invalid) return callback({ success: false, message: invalid });
      const existing = await Role.find({ serverId: server._id }).select("position").lean();
      if (existing.length >= MAX_ROLES) return callback({ success: false, message: `En fazla ${MAX_ROLES} rol olabilir.` });
      const role = await Role.create({
        serverId: server._id,
        name: name.trim(),
        color: color || null,
        hoist: hoist === true,
        position: existing.reduce((max, r) => Math.max(max, r.position + 1), 0),
        permissions: cleanPermissions(permissions),
      });
      callback({ success: true, role: serializeRole(role) });
      io.to(serverRoomName(server._id.toString())).emit("roles-changed", { serverId: server._id.toString() });
    } catch (err) {
      if (err.code === 11000) return callback({ success: false, message: "Bu isimde bir rol zaten var." });
      console.error("Rol oluşturulurken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("update-role", async ({ serverId, roleId, name, color = null, hoist = false, permissions } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return callback({ success: false, message: error });
      const invalid = validateRoleInput({ name, color }) || (isObjectId(roleId) ? null : "Rol bulunamadı.");
      if (invalid) return callback({ success: false, message: invalid });
      const role = await Role.findOneAndUpdate(
        { _id: roleId, serverId: server._id },
        { name: name.trim(), color: color || null, hoist: hoist === true, permissions: cleanPermissions(permissions) },
        { new: true }
      ).lean();
      if (!role) return callback({ success: false, message: "Rol bulunamadı." });
      callback({ success: true, role: serializeRole(role) });
      io.to(serverRoomName(server._id.toString())).emit("roles-changed", { serverId: server._id.toString() });
    } catch (err) {
      if (err.code === 11000) return callback({ success: false, message: "Bu isimde bir rol zaten var." });
      console.error("Rol güncellenirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Rol silinince üyelerden ve kanallardan da çıkıyor. Sadece bu role açık
  // olan kanal herkese açılmasın diye kimliği orada kalıyor: kanalı artık
  // sadece sahip görüyor, düzenleyince yeni roller seçilebiliyor.
  socket.on("delete-role", async ({ serverId, roleId } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return callback({ success: false, message: error });
      if (!isObjectId(roleId)) return callback({ success: false, message: "Rol bulunamadı." });
      const deleted = await Role.findOneAndDelete({ _id: roleId, serverId: server._id });
      if (!deleted) return callback({ success: false, message: "Rol bulunamadı." });
      await ServerMember.updateMany({ serverId: server._id }, { $pull: { roleIds: deleted._id } });
      await Channel.updateMany(
        { serverId: server._id, allowedRoleIds: deleted._id, "allowedRoleIds.1": { $exists: true } },
        { $pull: { allowedRoleIds: deleted._id } }
      );
      callback({ success: true });
      await afterAccessChange(server._id, "Bu kanala erişim yetkin kalmadı.", ["roles-changed", "channels-changed"]);
    } catch (err) {
      console.error("Rol silinirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Rolü bir üst ya da alt sıraya taşır (üstteki rol önce gelir).
  socket.on("move-role", async ({ serverId, roleId, direction } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return callback({ success: false, message: error });
      const roles = await Role.find({ serverId: server._id }).sort({ position: 1, createdAt: 1 }).lean();
      const index = roles.findIndex((r) => r._id.toString() === roleId);
      const target = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
      if (index < 0 || target < 0 || target >= roles.length) {
        return callback({ success: false, message: "Rol taşınamadı." });
      }
      [roles[index], roles[target]] = [roles[target], roles[index]];
      await Role.bulkWrite(
        roles.map((r, position) => ({ updateOne: { filter: { _id: r._id }, update: { position } } }))
      );
      callback({ success: true });
      io.to(serverRoomName(server._id.toString())).emit("roles-changed", { serverId: server._id.toString() });
    } catch (err) {
      console.error("Rol taşınırken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Bir üyenin rolleri (listenin tamamı). Rolünü kaybeden, o role açık
  // kanaldaysa oradan çıkarılıyor; yeni rolle açılan kanallar listesine geliyor.
  socket.on("set-member-roles", async ({ serverId, username, roleIds } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "isOwner");
      if (error) return callback({ success: false, message: error });
      const ids = await serverRoleIds(server._id, roleIds);
      if (!ids) return callback({ success: false, message: "Geçersiz rol." });
      const updated = await ServerMember.findOneAndUpdate(
        { serverId: server._id, username },
        { roleIds: ids },
        { new: true }
      ).lean();
      if (!updated) return callback({ success: false, message: "Bu kişi sunucunun üyesi değil." });
      callback({ success: true });
      await recheckUserAccess(username, "Bu kanala erişim yetkin kalmadı.");
      io.to(serverRoomName(server._id.toString())).emit("roles-changed", { serverId: server._id.toString() });
    } catch (err) {
      console.error("Üyenin rolleri güncellenirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Kanalın adı ve kimlerin göreceği. Kaydedince eski kısıtlama (platform
  // rolleri) temizleniyor, yerini sunucunun rolleri alıyor.
  socket.on("update-channel", async ({ serverId, channelId, name, allowedRoleIds = [] } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return callback({ success: false, message: error });
      if (typeof name !== "string" || !name.trim() || name.trim().length > 50) {
        return callback({ success: false, message: "Kanal adı 1-50 karakter olmalı." });
      }
      const ids = await serverRoleIds(server._id, allowedRoleIds);
      if (!ids || !isObjectId(channelId)) return callback({ success: false, message: "Geçersiz bilgi." });
      const channel = await Channel.findOneAndUpdate(
        { _id: channelId, serverId: server._id },
        { name: name.trim(), allowedRoleIds: ids, allowedRoles: [] },
        { new: true }
      ).lean();
      if (!channel) return callback({ success: false, message: "Böyle bir kanal yok." });
      callback({ success: true });
      await afterAccessChange(server._id, "Bu kanala erişim yetkin kalmadı.", ["channels-changed"]);
    } catch (err) {
      if (err.code === 11000) return callback({ success: false, message: "Bu isimde bir kanal zaten var." });
      console.error("Kanal güncellenirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Kanal silme: mesajları da siliniyor. Sunucunun son kanalı silinmiyor.
  socket.on("delete-channel", async ({ serverId, channelId } = {}, callback) => {
    if (typeof callback !== "function") return;
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return callback({ success: false, message: error });
      if (!isObjectId(channelId)) return callback({ success: false, message: "Böyle bir kanal yok." });
      if ((await Channel.countDocuments({ serverId: server._id })) <= 1) {
        return callback({ success: false, message: "Sunucunun son kanalı silinemez." });
      }
      const channel = await Channel.findOneAndDelete({ _id: channelId, serverId: server._id });
      if (!channel) return callback({ success: false, message: "Böyle bir kanal yok." });
      await Message.deleteMany({ channelId: channel._id });
      await ChannelMember.deleteMany({ channelId: channel._id });
      callback({ success: true });
      await afterAccessChange(server._id, "Bu kanal silindi.", ["channels-changed"]);
    } catch (err) {
      console.error("Kanal silinirken hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
