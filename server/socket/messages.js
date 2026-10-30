// Mesajlar üzerinde: sabitleme, kanalın sabitlenmiş mesajları, arama.
const mongoose = require("mongoose");
const { User, Message, Channel } = require("../db");
const { canAccessServer, canModerateServer, channelViewer, canViewChannel, checkChannelAccess } = require("../lib/access");
const { io } = require("../lib/realtime");
const { textRoomName } = require("../lib/state");
const { serializeMessage } = require("../lib/validate");

const MAX_PINS = 50;
const SEARCH_LIMIT = 25;
const isObjectId = (id) => typeof id === "string" && mongoose.isValidObjectId(id);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "from:Ece akşam" -> { from: "Ece", text: "akşam" }
function parseSearch(query) {
  let from = null;
  const text = query
    .replace(/(^|\s)from:(\S+)/i, (_match, space, name) => {
      from = name;
      return space;
    })
    .trim();
  return { from, text };
}

const withChannel = (message) => ({ ...serializeMessage(message), channelId: message.channelId.toString() });

module.exports = function registerMessageHandlers(socket, ctx) {
  const reply = (callback) => (typeof callback === "function" ? callback : () => {});

  // Sabitle ya da kaldır: sunucuda "Mesajları yönet" yetkisi, özel
  // mesajda iki taraf da. Sadece açık olan kanalın mesajları.
  socket.on("toggle-pin", async ({ messageId } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom || !isObjectId(messageId)) return done({ success: false, message: "Eksik bilgi." });
    try {
      const message = await Message.findOne({ _id: messageId, channelId: ctx.textRoom }).lean();
      if (!message) return done({ success: false, message: "Mesaj bulunamadı." });
      if (ctx.serverId) {
        const user = await User.findOne({ username: ctx.username }).select("roles").lean();
        if (!(await canModerateServer(ctx.username, user?.roles || [], ctx.serverId))) {
          return done({ success: false, message: "Bu işlemi yapma yetkin yok." });
        }
      }
      const pinned = message.pinnedAt ? null : { by: ctx.username, at: new Date() };
      if (pinned && (await Message.countDocuments({ channelId: ctx.textRoom, pinnedAt: { $ne: null } })) >= MAX_PINS) {
        return done({ success: false, message: `Bir kanalda en fazla ${MAX_PINS} mesaj sabitlenebilir.` });
      }
      await Message.updateOne(
        { _id: messageId },
        pinned ? { pinnedAt: pinned.at, pinnedBy: pinned.by } : { pinnedAt: null, pinnedBy: null }
      );
      done({ success: true, pinned });
      io.to(textRoomName(ctx.textRoom)).emit("message-pin-changed", { messageId, pinned });
    } catch (err) {
      console.error("Mesaj sabitlenirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("list-pins", async ({ channelId } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !isObjectId(channelId)) return done({ success: false, message: "Eksik bilgi." });
    try {
      const access = await checkChannelAccess(ctx.username, channelId);
      if (access.error) return done({ success: false, message: access.error });
      const pins = await Message.find({ channelId, pinnedAt: { $ne: null } }).sort({ pinnedAt: -1 }).limit(MAX_PINS).lean();
      done({ success: true, messages: pins.map(withChannel) });
    } catch (err) {
      console.error("Sabitlenmiş mesajlar alınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Arama: channelId verilirse o kanalda (özel mesaj dahil), yoksa
  // sunucunun görebildiğin bütün kanallarında. "from:Ece" kişiye göre.
  socket.on("search-messages", async ({ serverId, channelId, query } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || typeof query !== "string" || query.length > 200) {
      return done({ success: false, message: "Eksik bilgi." });
    }
    const { from, text } = parseSearch(query.trim());
    if (!from && text.length < 2) return done({ success: false, message: "En az iki harf yaz." });
    try {
      let channelIds;
      if (channelId) {
        const access = isObjectId(channelId) ? await checkChannelAccess(ctx.username, channelId) : { error: "Böyle bir kanal yok." };
        if (access.error) return done({ success: false, message: access.error });
        channelIds = [access.channel._id];
      } else {
        const user = await User.findOne({ username: ctx.username }).select("roles").lean();
        const roles = user?.roles || [];
        if (!isObjectId(serverId) || !(await canAccessServer(ctx.username, roles, serverId))) {
          return done({ success: false, message: "Bu sunucuya erişimin yok." });
        }
        const channels = await Channel.find({ serverId }).lean();
        const viewer = await channelViewer(ctx.username, roles, [serverId]);
        channelIds = channels.filter((c) => canViewChannel(viewer, c)).map((c) => c._id);
      }
      const filter = {
        channelId: { $in: channelIds },
        ...(text ? { text: { $regex: escapeRegex(text), $options: "i" } } : {}),
        ...(from ? { username: { $regex: `^${escapeRegex(from)}$`, $options: "i" } } : {}),
      };
      const found = await Message.find(filter).sort({ createdAt: -1 }).limit(SEARCH_LIMIT).lean();
      done({ success: true, messages: found.map(withChannel) });
    } catch (err) {
      console.error("Mesajlarda aranırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
