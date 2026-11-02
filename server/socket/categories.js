// Kanal kategorileri ve sıralama (Kanalları yönet): kategori oluşturma,
// adını değiştirme, silme; kanalları ve kategorileri sürükleyerek taşıma.
// Sıra "position" alanında; taşınan öğenin grubu (kategori ya da
// kategorisiz kısım / kategorilerin kendisi) baştan numaralanıyor.
const mongoose = require("mongoose");
const { Channel, ChannelCategory } = require("../db");
const { requireServerPermission } = require("../lib/access");
const { io } = require("../lib/realtime");
const { serverRoomName } = require("../lib/state");

const MAX_CATEGORIES = 50;
const isObjectId = (id) => typeof id === "string" && mongoose.isValidObjectId(id);

// Bir gruptaki öğeleri (kanallar ya da kategoriler) yeni sırasıyla yazar:
// movingId, beforeId'nin önüne (beforeId yoksa sona) giriyor. extra:
// taşınan öğeye ayrıca yazılacak alanlar (ör. yeni kategorisi).
async function reorder(Model, groupFilter, movingId, beforeId, extra = {}) {
  const siblings = await Model.find({ ...groupFilter, _id: { $ne: movingId } })
    .sort({ position: 1, createdAt: 1 })
    .select("_id")
    .lean();
  let index = beforeId ? siblings.findIndex((s) => s._id.toString() === beforeId) : -1;
  if (index < 0) index = siblings.length;
  siblings.splice(index, 0, { _id: new mongoose.Types.ObjectId(movingId) });
  await Model.bulkWrite(
    siblings.map((s, position) => ({
      updateOne: {
        filter: { _id: s._id },
        update: { position, ...(s._id.toString() === movingId ? extra : {}) },
      },
    }))
  );
}

const validName = (name) => typeof name === "string" && name.trim() && name.trim().length <= 50;

module.exports = function registerCategoryHandlers(socket, ctx) {
  const reply = (callback) => (typeof callback === "function" ? callback : () => {});
  const changed = (serverId) => io.to(serverRoomName(serverId.toString())).emit("channels-changed", { serverId: serverId.toString() });

  socket.on("create-category", async ({ serverId, name } = {}, callback) => {
    const done = reply(callback);
    if (!validName(name)) return done({ success: false, message: "Kategori adı 1-50 karakter olmalı." });
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return done({ success: false, message: error });
      const count = await ChannelCategory.countDocuments({ serverId: server._id });
      if (count >= MAX_CATEGORIES) return done({ success: false, message: `En fazla ${MAX_CATEGORIES} kategori olabilir.` });
      const category = await ChannelCategory.create({ serverId: server._id, name: name.trim(), position: count });
      done({ success: true, category: { id: category._id.toString(), name: category.name } });
      changed(server._id);
    } catch (err) {
      console.error("Kategori oluşturulurken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("update-category", async ({ serverId, categoryId, name } = {}, callback) => {
    const done = reply(callback);
    if (!validName(name) || !isObjectId(categoryId)) return done({ success: false, message: "Kategori adı 1-50 karakter olmalı." });
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return done({ success: false, message: error });
      const result = await ChannelCategory.updateOne({ _id: categoryId, serverId: server._id }, { name: name.trim() });
      if (!result.matchedCount) return done({ success: false, message: "Böyle bir kategori yok." });
      done({ success: true });
      changed(server._id);
    } catch (err) {
      console.error("Kategori güncellenirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Kategori silinince kanalları silinmiyor: kategorisiz kısmın sonuna geçiyor.
  socket.on("delete-category", async ({ serverId, categoryId } = {}, callback) => {
    const done = reply(callback);
    if (!isObjectId(categoryId)) return done({ success: false, message: "Böyle bir kategori yok." });
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return done({ success: false, message: error });
      const deleted = await ChannelCategory.deleteOne({ _id: categoryId, serverId: server._id });
      if (!deleted.deletedCount) return done({ success: false, message: "Böyle bir kategori yok." });
      const moved = await Channel.find({ serverId: server._id, categoryId }).sort({ position: 1, createdAt: 1 }).select("_id").lean();
      const last = await Channel.find({ serverId: server._id, categoryId: null }).sort({ position: -1 }).limit(1).lean();
      const start = (last[0]?.position ?? -1) + 1;
      await Channel.bulkWrite(
        moved.map((c, i) => ({ updateOne: { filter: { _id: c._id }, update: { categoryId: null, position: start + i } } }))
      );
      done({ success: true });
      changed(server._id);
    } catch (err) {
      console.error("Kategori silinirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Kanalı bir kategoriye (null: kategorisiz) ve beforeId'li kanalın önüne
  // (yoksa sona) taşır.
  socket.on("move-channel", async ({ serverId, channelId, categoryId = null, beforeId = null } = {}, callback) => {
    const done = reply(callback);
    if (!isObjectId(channelId) || (categoryId !== null && !isObjectId(categoryId)) || (beforeId !== null && !isObjectId(beforeId))) {
      return done({ success: false, message: "Geçersiz bilgi." });
    }
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return done({ success: false, message: error });
      const channel = await Channel.exists({ _id: channelId, serverId: server._id });
      if (!channel) return done({ success: false, message: "Böyle bir kanal yok." });
      if (categoryId && !(await ChannelCategory.exists({ _id: categoryId, serverId: server._id }))) {
        return done({ success: false, message: "Böyle bir kategori yok." });
      }
      const category = categoryId ? new mongoose.Types.ObjectId(categoryId) : null;
      await reorder(Channel, { serverId: server._id, categoryId: category }, channelId, beforeId, { categoryId: category });
      done({ success: true });
      changed(server._id);
    } catch (err) {
      console.error("Kanal taşınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("move-category", async ({ serverId, categoryId, beforeId = null } = {}, callback) => {
    const done = reply(callback);
    if (!isObjectId(categoryId) || (beforeId !== null && !isObjectId(beforeId))) {
      return done({ success: false, message: "Geçersiz bilgi." });
    }
    try {
      const { server, error } = await requireServerPermission(ctx.username, serverId, "manageChannels");
      if (error) return done({ success: false, message: error });
      if (!(await ChannelCategory.exists({ _id: categoryId, serverId: server._id }))) {
        return done({ success: false, message: "Böyle bir kategori yok." });
      }
      await reorder(ChannelCategory, { serverId: server._id }, categoryId, beforeId);
      done({ success: true });
      changed(server._id);
    } catch (err) {
      console.error("Kategori taşınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
