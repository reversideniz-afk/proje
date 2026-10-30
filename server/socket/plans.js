// Anketler ve etkinlikler: açık kanala özel bir mesaj olarak gidiyor
// (metni başlığı; arama ve bildirimler onunla çalışıyor). Oylar ve
// katılımlar değişince kanaldakilere güncel hâli gidiyor; sunucunun
// yaklaşan etkinlik listesi de yenileniyor.
const mongoose = require("mongoose");
const { User, Message, Channel } = require("../db");
const { canAccessServer, canModerateServer, channelViewer, canViewChannel } = require("../lib/access");
const { io } = require("../lib/realtime");
const { serverRoomName, textRoomName } = require("../lib/state");
const { serializeMessage, serializePoll, serializeEvent } = require("../lib/validate");

const isObjectId = (id) => typeof id === "string" && mongoose.isValidObjectId(id);
const RSVP_CHOICES = ["going", "maybe", "none"];
const YEAR_MS = 365 * 24 * 3_600_000;

module.exports = function registerPlanHandlers(socket, ctx) {
  const reply = (callback) => (typeof callback === "function" ? callback : () => {});

  // Kanala yeni anket ya da etkinlik mesajı: herkese mesaj, kanalda
  // olmayanlara bildirim (send-message ile aynı).
  async function postToChannel(fields, activityText) {
    const message = await Message.create({ channelId: ctx.textRoom, username: ctx.username, ...fields });
    io.to(textRoomName(ctx.textRoom)).emit("new-message", serializeMessage(message.toObject()));
    socket.to(`member-notify:${ctx.textRoom}`).emit("channel-activity", {
      channelId: ctx.textRoom,
      serverId: ctx.serverId,
      username: ctx.username,
      text: activityText,
      replyToUsername: null,
      dm: !ctx.serverId,
    });
    return message;
  }

  const eventsChanged = () => {
    if (ctx.serverId) io.to(serverRoomName(ctx.serverId)).emit("events-changed", { serverId: ctx.serverId });
  };

  socket.on("create-poll", async ({ question, options, multiple = false } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom) return done({ success: false, message: "Önce bir kanala gir." });
    const cleanQuestion = typeof question === "string" ? question.trim() : "";
    const cleanOptions = Array.isArray(options)
      ? options.filter((o) => typeof o === "string").map((o) => o.trim()).filter(Boolean)
      : [];
    if (!cleanQuestion || cleanQuestion.length > 200) return done({ success: false, message: "Soru 1-200 karakter olmalı." });
    if (cleanOptions.length < 2 || cleanOptions.length > 6 || cleanOptions.some((o) => o.length > 80)) {
      return done({ success: false, message: "2-6 seçenek, her biri en fazla 80 karakter." });
    }
    try {
      const message = await postToChannel(
        {
          text: cleanQuestion,
          poll: { question: cleanQuestion, multiple: multiple === true, options: cleanOptions.map((text) => ({ text, votes: [] })) },
        },
        `📊 Anket: ${cleanQuestion}`.slice(0, 200)
      );
      done({ success: true, messageId: message._id.toString() });
    } catch (err) {
      console.error("Anket oluşturulurken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Tek seçimli ankette seçilen seçeneğe geçiş (aynısına tekrar basınca
  // oy geri alınıyor); çok seçimlide her seçenek ayrı aç/kapa.
  socket.on("vote-poll", async ({ messageId, optionIndex } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom || !isObjectId(messageId)) return done({ success: false, message: "Eksik bilgi." });
    try {
      const message = await Message.findOne({ _id: messageId, channelId: ctx.textRoom, poll: { $exists: true } }).lean();
      if (!message) return done({ success: false, message: "Anket bulunamadı." });
      if (message.poll.closed) return done({ success: false, message: "Anket bitti." });
      const option = message.poll.options[optionIndex];
      if (!Number.isInteger(optionIndex) || !option) return done({ success: false, message: "Geçersiz seçenek." });
      const had = option.votes.includes(ctx.username);
      const path = `poll.options.${optionIndex}.votes`;
      if (!message.poll.multiple) {
        await Message.updateOne({ _id: messageId }, { $pull: { "poll.options.$[].votes": ctx.username } });
      } else if (had) {
        await Message.updateOne({ _id: messageId }, { $pull: { [path]: ctx.username } });
      }
      if (!had) await Message.updateOne({ _id: messageId }, { $addToSet: { [path]: ctx.username } });
      const updated = await Message.findById(messageId).select("poll").lean();
      done({ success: true });
      io.to(textRoomName(ctx.textRoom)).emit("poll-updated", { messageId, poll: serializePoll(updated.poll) });
    } catch (err) {
      console.error("Oy verilirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Anketi bitir: açan kişi ya da "Mesajları yönet" yetkisi olan.
  socket.on("close-poll", async ({ messageId } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom || !isObjectId(messageId)) return done({ success: false, message: "Eksik bilgi." });
    try {
      const message = await Message.findOne({ _id: messageId, channelId: ctx.textRoom, poll: { $exists: true } }).lean();
      if (!message) return done({ success: false, message: "Anket bulunamadı." });
      if (message.username !== ctx.username) {
        const user = await User.findOne({ username: ctx.username }).select("roles").lean();
        if (!(await canModerateServer(ctx.username, user?.roles || [], ctx.serverId))) {
          return done({ success: false, message: "Anketi sadece açan kişi bitirebilir." });
        }
      }
      await Message.updateOne({ _id: messageId }, { "poll.closed": true });
      done({ success: true });
      io.to(textRoomName(ctx.textRoom)).emit("poll-updated", {
        messageId,
        poll: serializePoll({ ...message.poll, closed: true }),
      });
    } catch (err) {
      console.error("Anket bitirilirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Etkinlik: açan kişi "katılıyorum" sayılıyor.
  socket.on("create-event", async ({ title, startsAt, description = "" } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom) return done({ success: false, message: "Önce bir kanala gir." });
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanDescription = typeof description === "string" ? description.trim() : "";
    const start = new Date(startsAt);
    if (!cleanTitle || cleanTitle.length > 100) return done({ success: false, message: "Başlık 1-100 karakter olmalı." });
    if (cleanDescription.length > 500) return done({ success: false, message: "Açıklama en fazla 500 karakter." });
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 5 * 60_000 || start.getTime() > Date.now() + YEAR_MS) {
      return done({ success: false, message: "Tarih şu andan sonra ve bir yıl içinde olmalı." });
    }
    try {
      const message = await postToChannel(
        {
          text: cleanTitle,
          event: { title: cleanTitle, startsAt: start, description: cleanDescription, going: [ctx.username], maybe: [] },
        },
        `📅 Etkinlik: ${cleanTitle}`.slice(0, 200)
      );
      done({ success: true, messageId: message._id.toString() });
      eventsChanged();
    } catch (err) {
      console.error("Etkinlik oluşturulurken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("rsvp-event", async ({ messageId, choice } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !ctx.textRoom || !isObjectId(messageId) || !RSVP_CHOICES.includes(choice)) {
      return done({ success: false, message: "Eksik bilgi." });
    }
    try {
      const filter = { _id: messageId, channelId: ctx.textRoom, event: { $exists: true } };
      const pulled = await Message.updateOne(filter, { $pull: { "event.going": ctx.username, "event.maybe": ctx.username } });
      if (!pulled.matchedCount) return done({ success: false, message: "Etkinlik bulunamadı." });
      if (choice !== "none") await Message.updateOne(filter, { $addToSet: { [`event.${choice}`]: ctx.username } });
      const updated = await Message.findById(messageId).select("event").lean();
      done({ success: true });
      io.to(textRoomName(ctx.textRoom)).emit("event-updated", { messageId, event: serializeEvent(updated.event) });
      eventsChanged();
    } catch (err) {
      console.error("Etkinliğe katılım kaydedilirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Sunucunun yaklaşan etkinlikleri (görebildiğin kanallarda; 3 saat
  // öncesine kadar başlamış olanlar da), en yakını önce.
  socket.on("list-events", async ({ serverId } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || !isObjectId(serverId)) return done({ success: false, message: "Eksik bilgi." });
    try {
      const user = await User.findOne({ username: ctx.username }).select("roles").lean();
      const roles = user?.roles || [];
      if (!(await canAccessServer(ctx.username, roles, serverId))) return done({ success: false, message: "Bu sunucuya erişimin yok." });
      const channels = await Channel.find({ serverId }).lean();
      const viewer = await channelViewer(ctx.username, roles, [serverId]);
      const visible = channels.filter((c) => canViewChannel(viewer, c)).map((c) => c._id);
      const events = await Message.find({
        channelId: { $in: visible },
        "event.startsAt": { $gte: new Date(Date.now() - 3 * 3_600_000) },
      })
        .sort({ "event.startsAt": 1 })
        .limit(10)
        .lean();
      done({
        success: true,
        events: events.map((m) => ({ id: m._id.toString(), channelId: m.channelId.toString(), createdAt: m.createdAt, ...serializeEvent(m.event) })),
      });
    } catch (err) {
      console.error("Etkinlikler alınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
