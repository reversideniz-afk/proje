// Arkadaşlık istekleri ve özel mesajlar: liste, istek gönderme, kabul /
// ret, arkadaşlıktan çıkarma, özel mesaj açma ve listesi.
const { Friendship } = require("../db");
const { pairKey, canMessage, findOrCreateDm, friendLists, dmList, emitToUsers } = require("../lib/friends");
const { socketsByUsername } = require("../lib/state");
const { findUsersByName } = require("../lib/users");

module.exports = function registerFriendHandlers(socket, ctx) {
  const reply = (callback) => (typeof callback === "function" ? callback : () => {});
  // İki kişinin de listeleri yenilensin.
  const changed = (...usernames) => emitToUsers(usernames, "friends-changed", {});

  socket.on("list-friends", async (_payload, callback) => {
    const done = reply(callback);
    if (!ctx.username) return done({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      done({ success: true, ...(await friendLists(ctx.username)) });
    } catch (err) {
      console.error("Arkadaşlar alınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Karşı taraf zaten istek gönderdiyse doğrudan arkadaş oluyorlar.
  socket.on("send-friend-request", async ({ username } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username) return done({ success: false, message: "Önce giriş yapman gerekiyor." });
    if (typeof username !== "string" || !username.trim()) return done({ success: false, message: "Kullanıcı adını yaz." });
    try {
      const target = (await findUsersByName(username.trim()))[0];
      if (!target) return done({ success: false, message: "Bu adda biri yok." });
      if (target.username === ctx.username) return done({ success: false, message: "Kendine istek gönderemezsin." });
      const pair = pairKey(ctx.username, target.username);
      const existing = await Friendship.findOne({ pair }).lean();
      if (existing?.status === "accepted") return done({ success: false, message: "Zaten arkadaşsınız." });
      if (existing && existing.requester === ctx.username) {
        return done({ success: false, message: "İstek zaten gönderildi." });
      }
      if (existing) {
        await Friendship.updateOne({ pair }, { status: "accepted", acceptedAt: new Date() });
        done({ success: true, accepted: true, username: target.username });
      } else {
        await Friendship.create({ pair, users: [ctx.username, target.username], requester: ctx.username });
        done({ success: true, accepted: false, username: target.username });
      }
      changed(ctx.username, target.username);
    } catch (err) {
      if (err.code === 11000) return done({ success: false, message: "İstek zaten gönderildi." });
      console.error("Arkadaşlık isteği gönderilirken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Gelen isteği kabul ya da reddet.
  socket.on("respond-friend-request", async ({ username, accept } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || typeof username !== "string") return done({ success: false, message: "Eksik bilgi." });
    try {
      const pair = pairKey(ctx.username, username);
      const request = await Friendship.findOne({ pair, status: "pending", requester: username }).lean();
      if (!request) return done({ success: false, message: "Böyle bir istek yok." });
      if (accept === true) await Friendship.updateOne({ pair }, { status: "accepted", acceptedAt: new Date() });
      else await Friendship.deleteOne({ pair });
      done({ success: true });
      changed(ctx.username, username);
    } catch (err) {
      console.error("Arkadaşlık isteği yanıtlanırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Arkadaşlıktan çıkarma ya da gönderilen isteği geri alma.
  socket.on("remove-friend", async ({ username } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || typeof username !== "string") return done({ success: false, message: "Eksik bilgi." });
    try {
      const { deletedCount } = await Friendship.deleteOne({ pair: pairKey(ctx.username, username) });
      if (!deletedCount) return done({ success: false, message: "Arkadaş listende yok." });
      done({ success: true });
      changed(ctx.username, username);
    } catch (err) {
      console.error("Arkadaş çıkarılırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // Özel mesajı aç (yoksa oluştur). Arkadaşlar ve aynı sunucudakiler.
  socket.on("open-dm", async ({ username } = {}, callback) => {
    const done = reply(callback);
    if (!ctx.username || typeof username !== "string") return done({ success: false, message: "Eksik bilgi." });
    try {
      const target = (await findUsersByName(username))[0];
      if (!target || !(await canMessage(ctx.username, target.username))) {
        return done({ success: false, message: "Bu kişiye mesaj gönderemezsin: arkadaş ya da aynı sunucuda değilsiniz." });
      }
      const channel = await findOrCreateDm(ctx.username, target.username);
      // İkisinin de bağlantıları bu konuşmanın bildirim odasına girsin.
      for (const name of [ctx.username, target.username]) {
        for (const s of socketsByUsername.get(name) || []) await s.data.refreshServerRooms?.();
      }
      done({ success: true, channelId: channel._id.toString(), username: target.username });
    } catch (err) {
      console.error("Özel mesaj açılırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  socket.on("list-dms", async (_payload, callback) => {
    const done = reply(callback);
    if (!ctx.username) return done({ success: false, message: "Önce giriş yapman gerekiyor." });
    try {
      done({ success: true, dms: await dmList(ctx.username) });
    } catch (err) {
      console.error("Özel mesajlar alınırken hata:", err.message);
      done({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });
};
