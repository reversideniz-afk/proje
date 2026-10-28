// Metin kanalları: girme/çıkma, mesajlar, tepkiler, düzenleme ve silme,
// !sil komutları, yazıyor göstergesi, eski mesajlar, bağlantının kopması.
const { User, Message, ChannelMember } = require("../db");
const { canModerateServer, checkChannelAccess } = require("../lib/access");
const { io } = require("../lib/realtime");
const { relayPhoto, announcePresence, buildMemberList } = require("../lib/rooms");
const { socketsByUsername, textRooms, textRoomName } = require("../lib/state");
const { isValidImageDataUri, serializeMessage } = require("../lib/validate");

module.exports = function registerChannelHandlers(socket, ctx) {
  // ---- YENİ: Metin kanalına katılma (SES BAĞLANTISI KURMAZ) ----
  // ÇOKLU SUNUCU: artık kanal ismi değil, hangi SUNUCUdaki hangi KANAL
  // (ikisi de ObjectId) belirtiliyor — oda/DB anahtarı olarak kanalın
  // ObjectId'si (channelId) kullanılıyor, isim çakışması riski kalmıyor.
  // İsteğe bağlı ack: yeni istemciler "kanala girdim" onayını bekleyip ondan
  // sonra (ör. yeniden bağlanınca) sese katılıyor. Eski istemciler ack
  // göndermiyor, onlar için join-error olayı aynen duruyor.
  socket.on("join-channel", async ({ serverId, channelId, token } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const fail = (message) => {
      socket.emit("join-error", message);
      reply({ success: false, message });
    };
    const username = await ctx.authenticate(token);
    if (typeof serverId !== "string" || typeof channelId !== "string" || !username) {
      fail("Önce giriş yapman gerekiyor.");
      return;
    }

    // Eski istemciler bağlantıyı el sıkışmada değil burada (anahtarla)
    // kullanıcıya bağlıyor.
    ctx.bindUser(username);

    // Sunucu üyeliği ve ROL kontrolü (kullanıcının rollerinden en az biri
    // kanalın izinli rolleri arasında olmalı).
    const access = await checkChannelAccess(username, channelId, serverId);
    if (access.error) {
      fail(access.error);
      return;
    }
    // roomId artık kanalın ObjectId'sinin metin hali — hem Socket.io oda
    // adı hem de Message/ChannelMember sorgu anahtarı olarak kullanılıyor.
    const roomId = channelId;

    // DÜZELTME: artık istemci sesteyken kanal değiştirdiğinde (sesi
    // koparmadan başka bir kanalın mesajlarını okuyabilmek için) AYNI
    // soketi tekrar kullanıyor. Bu yüzden eski metin kanalından socket.io
    // oda üyeliğini burada AÇIKÇA bırakmazsak, o kanala yeni mesaj
    // geldiğinde bu soket hâlâ dinlemeye devam eder ve mesaj yanlışlıkla
    // görüntülenen YENİ kanalın sohbetine karışır. Ses odası (voiceRoomName)
    // bundan tamamen ayrı bir isim alanı olduğu için etkilenmiyor.
    // Eski kanalın çevrimiçi kaydı da siliniyor ve oradakilere güncel liste
    // gidiyor; eskiden kayıt kalıyor, kişi gezdiği kanallarda uygulamayı
    // kapattıktan sonra da çevrimiçi görünüyordu (H5).
    let previousTextRoom = null;
    if (ctx.textRoom && ctx.textRoom !== roomId) {
      previousTextRoom = ctx.textRoom;
      socket.leave(textRoomName(previousTextRoom));
      if (textRooms[previousTextRoom]) {
        delete textRooms[previousTextRoom][socket.id];
        if (Object.keys(textRooms[previousTextRoom]).length === 0) delete textRooms[previousTextRoom];
      }
    }
    ctx.textRoom = roomId;
    ctx.serverId = serverId;
    socket.join(textRoomName(roomId));
    if (!textRooms[roomId]) textRooms[roomId] = {};
    textRooms[roomId][socket.id] = { username };

    // Kalıcı üyelik kaydı: "çevrimdışı üyeler" listesi ve okunmamışlar için.
    // Önceki kayıttaki son okuma anı istemciye gidiyor ("Yeni" çizgisi).
    // Bildirim odalarına bağlantı giriş yapınca giriyor (bkz.
    // ctx.refreshServerRooms).
    let lastReadAt = null;
    try {
      const previous = await ChannelMember.findOneAndUpdate(
        { channelId: roomId, username },
        { lastSeenAt: new Date() },
        { upsert: true }
      ).lean();
      lastReadAt = previous ? previous.lastReadAt || previous.lastSeenAt || null : null;
    } catch (err) {
      console.error("Kanal üyeliği kaydedilirken hata:", err.message);
    }

    // Diğer metin-kanalı üyelerine bildir.
    socket.to(textRoomName(roomId)).emit("member-online", { username });

    // Üye listesi (online + offline) — hem yeni katılana hem herkese
    // güncel listeyi gönderiyoruz (basit ve tutarlı kalsın diye).
    const memberList = await buildMemberList(roomId);
    io.to(textRoomName(roomId)).emit("channel-members", memberList);
    if (previousTextRoom) {
      io.to(textRoomName(previousTextRoom)).emit(
        "channel-members",
        await buildMemberList(previousTextRoom)
      );
    }

    // Mesaj geçmişi (sadece yeni katılana).
    try {
      const history = await Message.find({ channelId: roomId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();
      socket.emit("message-history", history.reverse().map(serializeMessage));
    } catch (err) {
      console.error("Mesaj geçmişi alınırken hata:", err.message);
    }
    reply({ success: true, lastReadAt });
  });

  // Kanal okundu: istemci kanal açık ve pencere öndeyken bildiriyor.
  socket.on("mark-read", async ({ channelId } = {}) => {
    if (!ctx.username || typeof channelId !== "string") return;
    if ((await checkChannelAccess(ctx.username, channelId)).error) return;
    try {
      await ChannelMember.findOneAndUpdate(
        { channelId, username: ctx.username },
        { lastReadAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error("Okundu bilgisi kaydedilirken hata:", err.message);
    }
  });

  // Kanaldan çıkma (metin + ses), uygulama açık kalırken: yeni istemciler
  // tek bağlantıyı kapatmadan kanaldan ayrılıyor.
  socket.on("leave-channel", async (_payload, ack) => {
    await ctx.leaveChannels();
    if (typeof ack === "function") ack({ success: true });
  });

  // ---- Sohbet mesajı gönderme (kalıcı) ----
  socket.on("send-message", async ({ token, text }) => {
    const username = await ctx.authenticate(token);
    // GÜVENLİK/SAĞLAMLIK: "text" beklenmedik bir tipte (ör. bir nesne)
    // gelirse .trim() çağrısı hata fırlatabilirdi — bunu try/catch'e
    // girmeden, en başta AÇIKÇA reddediyoruz.
    if (!username || !ctx.textRoom || typeof text !== "string") return;
    const trimmedText = text.trim();
    if (!trimmedText || trimmedText.length > 2000) return;

    try {
      const message = await Message.create({
        channelId: ctx.textRoom,
        username,
        text: trimmedText,
      });
      io.to(textRoomName(ctx.textRoom)).emit("new-message", {
        id: message._id.toString(),
        username: message.username,
        text: message.text,
        createdAt: message.createdAt,
        editedAt: null,
        reactions: [],
      });
      // YENİ: bu kanalın ÜYESİ olan ama şu an BAŞKA bir kanalda olan
      // kişilere hafif bir "burada bir şey oldu" işareti gönder —
      // okunmamış kanal işareti için. Kendisi zaten mesajı gördüğü
      // için göndereni hariç tutuyoruz.
      // Bildirim için kim yazdı ve ne yazdı (kısaltılmış) da gidiyor.
      socket.to(`member-notify:${ctx.textRoom}`).emit("channel-activity", {
        channelId: ctx.textRoom,
        serverId: ctx.serverId,
        username,
        text: trimmedText.slice(0, 200),
      });
    } catch (err) {
      console.error("Mesaj kaydedilirken hata:", err.message);
    }
  });

  // ---- YENİ: Yazıyor... göstergesi ----
  socket.on("typing-start", async ({ token }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    socket.to(textRoomName(ctx.textRoom)).emit("user-typing", { username });
  });

  socket.on("typing-stop", async ({ token }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    socket.to(textRoomName(ctx.textRoom)).emit("user-stopped-typing", { username });
  });

  // ---- YENİ: Mesaj emoji tepkisi (aç/kapa) ----
  socket.on("toggle-reaction", async ({ token, messageId, emoji }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    if (typeof messageId !== "string" || typeof emoji !== "string") return;
    if (emoji.length > 8) return; // tek bir emoji karakteri için fazlasıyla yeterli

    try {
      const message = await Message.findOne({ _id: messageId, channelId: ctx.textRoom });
      if (!message) return;

      const existingIndex = message.reactions.findIndex(
        (r) => r.username === username && r.emoji === emoji
      );
      if (existingIndex >= 0) {
        message.reactions.splice(existingIndex, 1);
      } else {
        message.reactions.push({ emoji, username });
      }
      await message.save();

      io.to(textRoomName(ctx.textRoom)).emit("reactions-updated", {
        messageId,
        reactions: message.reactions,
      });
    } catch (err) {
      console.error("Tepki güncellenirken hata:", err.message);
    }
  });

  // ---- YENİ: Tek bir mesajı silme ----
  // GÜVENLİK: sadece KENDİ mesajını silebilirsin — başkasının mesajını
  // silme yetkisi hiç kimseye verilmiyor, "channel" ve "username" ikisi
  // birden eşleşmeli.
  socket.on("delete-message", async ({ token, messageId }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom || typeof messageId !== "string") return;

    try {
      // YENİ: bu kanalın bağlı olduğu SUNUCUNUN sahibi (ya da platform
      // admini) BAŞKASININ tek bir mesajını da silebilir (moderasyon,
      // arayüzden tek tıkla) — normal kullanıcılar hâlâ sadece kendi
      // mesajını silebiliyor.
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      const canModerate = await canModerateServer(username, userRoles, ctx.serverId);
      const filter = canModerate
        ? { _id: messageId, channelId: ctx.textRoom }
        : { _id: messageId, channelId: ctx.textRoom, username };
      const result = await Message.deleteOne(filter);
      if (result.deletedCount > 0) {
        io.to(textRoomName(ctx.textRoom)).emit("messages-deleted", { messageIds: [messageId] });
      }
    } catch (err) {
      console.error("Mesaj silinirken hata:", err.message);
    }
  });

  // ---- YENİ: Tek bir mesajı düzenleme ----
  // GÜVENLİK: sadece KENDİ mesajını düzenleyebilirsin.
  socket.on("edit-message", async ({ token, messageId, newText }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    if (typeof messageId !== "string" || typeof newText !== "string") return;
    const trimmed = newText.trim();
    if (!trimmed || trimmed.length > 2000) return;

    try {
      const message = await Message.findOne({
        _id: messageId,
        channelId: ctx.textRoom,
        username,
      });
      if (!message) return;
      message.text = trimmed;
      message.editedAt = new Date();
      await message.save();

      io.to(textRoomName(ctx.textRoom)).emit("message-edited", {
        messageId,
        newText: trimmed,
        editedAt: message.editedAt,
      });
    } catch (err) {
      console.error("Mesaj düzenlenirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil n" komutu — KENDİ son N mesajını topluca sil ----
  // GÜVENLİK: sadece gönderenin KENDİ mesajları siliniyor — bir kanaldaki
  // TÜM geçmişi ya da başkalarının mesajlarını silme yetkisi yok. Bu,
  // "yanlışlıkla bir şey paylaştım, hemen geri alayım" senaryosu için.
  socket.on("delete-last-n", async ({ token, n }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    const count = Number(n);
    if (!Number.isInteger(count) || count < 1) return;
    const cappedCount = Math.min(count, 200); // aşırı büyük bir değere karşı makul bir tavan

    try {
      const toDelete = await Message.find({ channelId: ctx.textRoom, username })
        .sort({ createdAt: -1 })
        .limit(cappedCount)
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Silinecek mesajın yok.",
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(ctx.textRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      socket.emit("new-message", {
        username: "Sistem",
        system: true,
        text: `${idsToDelete.length} mesajın silindi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Toplu mesaj silinirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil @kullanıcı n" komutu — SADECE ADMIN_ROLE rolüne
  // sahip hesaplar kullanabilir; hedef kullanıcının BU KANALDAKİ son N
  // mesajını siler. "!sil @kullanıcı"dan (tümünü siler) farkı: burada
  // sayıyla sınırlı, daha "cerrahi" bir moderasyon aracı.
  socket.on("delete-user-last-n", async ({ token, targetUsername, n }) => {
    const username = await ctx.authenticate(token);
    const count = Number(n);
    if (
      !username ||
      !ctx.textRoom ||
      typeof targetUsername !== "string" ||
      !targetUsername.trim() ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      return;
    }
    const target = targetUsername.trim();
    const cappedCount = Math.min(count, 200);

    try {
      const requester = await User.findOne({ username }).lean();
      const userRoles = requester?.roles || [];
      if (!(await canModerateServer(username, userRoles, ctx.serverId))) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channelId: ctx.textRoom, username: target })
        .sort({ createdAt: -1 })
        .limit(cappedCount)
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: `${target} adlı kullanıcının bu kanalda silinecek mesajı yok.`,
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(ctx.textRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      // YENİ: bu bir moderasyon eylemi — sadece komutu yazana değil,
      // kanaldaki HERKESE görünür oluyor (şeffaflık için).
      io.to(textRoomName(ctx.textRoom)).emit("new-message", {
        username: "Sistem",
        system: true,
        text: `${username}, ${target} kullanıcısının son ${idsToDelete.length} mesajını sildi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Kullanıcının son mesajları silinirken hata:", err.message);
    }
  });

  // ---- YENİ: "!sil @kullanıcı" komutu — SADECE ADMIN_ROLE rolüne sahip
  // hesaplar kullanabilir; hedef kullanıcının BU KANALDAKİ tüm mesajlarını
  // siler (moderasyon: spam/uygunsuz içerik temizliği). delete-last-n'den
  // farkı: kendi mesajınla sınırlı değilsin ve sayı değil, kullanıcı adı
  // hedefliyorsun.
  socket.on("delete-user-messages", async ({ token, targetUsername }) => {
    const username = await ctx.authenticate(token);
    if (
      !username ||
      !ctx.textRoom ||
      typeof targetUsername !== "string" ||
      !targetUsername.trim()
    ) {
      return;
    }
    const target = targetUsername.trim();

    try {
      const requester = await User.findOne({ username }).lean();
      const requesterRoles = requester?.roles || [];
      if (!(await canModerateServer(username, requesterRoles, ctx.serverId))) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: "Bu komutu kullanma yetkin yok.",
          createdAt: new Date(),
        });
        return;
      }

      const toDelete = await Message.find({ channelId: ctx.textRoom, username: target })
        .select("_id")
        .lean();
      const idsToDelete = toDelete.map((m) => m._id);
      if (idsToDelete.length === 0) {
        socket.emit("new-message", {
          username: "Sistem",
          system: true,
          text: `${target} adlı kullanıcının bu kanalda silinecek mesajı yok.`,
          createdAt: new Date(),
        });
        return;
      }
      await Message.deleteMany({ _id: { $in: idsToDelete } });
      io.to(textRoomName(ctx.textRoom)).emit("messages-deleted", {
        messageIds: idsToDelete.map((id) => id.toString()),
      });
      // YENİ: bu bir moderasyon eylemi — sadece komutu yazana değil,
      // kanaldaki HERKESE görünür oluyor (şeffaflık için).
      io.to(textRoomName(ctx.textRoom)).emit("new-message", {
        username: "Sistem",
        system: true,
        text: `${username}, ${target} kullanıcısının ${idsToDelete.length} mesajını sildi.`,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Kullanıcının mesajları silinirken hata:", err.message);
    }
  });

  // ---- Fotoğraf paylaşımı, ESKİ yol: yeni istemciler /api/photos'u
  // kullanıyor (bkz. yukarıda). Güncellemeyi henüz almamış istemciler için
  // duruyor; paket sınırı 1 MB olduğu için sadece küçük fotoğraflar geçer.
  socket.on("send-photo", async ({ token, imageData, mimeType }) => {
    const username = await ctx.authenticate(token);
    if (!username || !ctx.textRoom) return;
    if (!isValidImageDataUri(imageData, mimeType)) return;
    relayPhoto(ctx.textRoom, username, imageData, mimeType, [socket.id]);
  });

  // ---- Daha eski mesajları getirme (geçmiş SINIRSIZ, parça parça) ----
  socket.on("load-older-messages", async ({ token, before }, callback) => {
    const username = await ctx.authenticate(token);
    // GÜVENLİK DÜZELTMESİ: hangi kanaldan istediğimizi istemciden
    // ALMIYORUZ artık — sunucunun KENDİ, doğrulanmış kaydı olan
    // ctx.textRoom'u kullanıyoruz. Önceki halinde, istemci
    // "channel" alanına özel hazırlanmış bir değer göndererek
    // teorik olarak BAŞKA bir kanalın (şifresini bilmediği bir
    // kanalın) mesajlarını isteyebilirdi — artık bu imkansız,
    // çünkü sadece kendi ZATEN girmiş olduğu kanalın geçmişini
    // isteyebiliyor.
    if (!username || !ctx.textRoom) {
      if (typeof callback === "function") callback({ messages: [] });
      return;
    }
    try {
      const query = { channelId: ctx.textRoom };
      if (before) query.createdAt = { $lt: new Date(before) };
      const older = await Message.find(query).sort({ createdAt: -1 }).limit(50).lean();
      if (typeof callback === "function")
        callback({ messages: older.reverse().map(serializeMessage) });
    } catch (err) {
      console.error("Eski mesajlar alınırken hata:", err.message);
      if (typeof callback === "function") callback({ messages: [] });
    }
  });

  // ---- Ayrılma (bağlantı tamamen kopunca) ----
  socket.on("disconnect", async () => {
    await ctx.leaveChannels();
    if (ctx.username) {
      const sockets = socketsByUsername.get(ctx.username);
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) {
        socketsByUsername.delete(ctx.username);
        announcePresence(socket.data.serverIds || []);
      }
    }
  });
};
