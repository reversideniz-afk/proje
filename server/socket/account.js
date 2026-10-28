// Hesap: giriş, oturum devamı, çıkış, kayıt ve profil fotoğrafı.
const bcrypt = require("bcryptjs");
const { User, BannedIp } = require("../db");
const { getAccessibleServers } = require("../lib/access");
const { AVATAR_TYPES, avatarUrl } = require("../lib/avatars");
const { unreadByServer } = require("../lib/unread");
const { buildIceServers } = require("../lib/ice");
const { MAX_LOGIN_ATTEMPTS, LOGIN_LOCK_MS, MAX_REGISTER_ATTEMPTS_PER_WINDOW, REGISTER_ATTEMPT_WINDOW_MS, registerAttemptsByIp, bannedIpSet, getClientIp, isLoginBlockedForIp, recordLoginFailure } = require("../lib/limits");
const { io } = require("../lib/realtime");
const { notifyAdmins, buildMemberList, announcePresence } = require("../lib/rooms");
const { sessionCache, createSession, findSession, refreshSession, deleteSession, resolveUsername } = require("../lib/sessions");
const { voiceRooms, textRoomName, voiceRoomName } = require("../lib/state");
const { findUsersByName, isReservedUsername } = require("../lib/users");
const { isValidImageDataUri } = require("../lib/validate");

module.exports = function registerAccountHandlers(socket, ctx) {
  // ---- Kişisel hesap girişi ----
  socket.on("login", async ({ username, password, rememberMe }, callback) => {
    // GÜVENLİK: sadece "boş mu" değil, "gerçekten metin mi" diye de
    // AÇIKÇA kontrol ediyoruz — biri kullanıcı adı yerine özel
    // hazırlanmış bir nesne gönderirse (MongoDB sorgu operatörü gibi),
    // bunun sessizce bir "yan etkiye" güvenerek değil, kasıtlı olarak
    // reddedilmesini istiyoruz.
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return callback({ success: false, message: "Kullanıcı adı ve şifre gerekli." });
    }
    const ip = getClientIp(socket);
    if (isLoginBlockedForIp(ip)) {
      return callback({
        success: false,
        message: "Bu bağlantıdan çok fazla yanlış deneme yapıldı, biraz sonra tekrar dene.",
      });
    }
    try {
      // Büyük/küçük harfe duyarsız: "alganis" yazan da girebiliyor.
      const [user] = await findUsersByName(username.trim());
      if (!user) {
        recordLoginFailure(ip);
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }

      // YENİ: hesap kilitli mi? (5 yanlış şifreden sonra 15 dakikalığına,
      // ya da bir yönetici erken açana kadar — bkz. unlock-user-login).
      if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
        const minutesLeft = Math.ceil((user.loginLockedUntil - new Date()) / 60000);
        return callback({
          success: false,
          message: `Çok fazla yanlış deneme yapıldı. Hesabın ${minutesLeft} dakika kilitli, ya da bir yöneticiden açmasını iste.`,
        });
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        // YENİ: yanlış şifre sayacını artır, eşiği geçtiyse kilitle.
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
          user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
        }
        await user.save();
        recordLoginFailure(ip);
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }

      // Başarılı giriş — sayaç ve varsa kilit sıfırlanır.
      if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
        user.failedLoginAttempts = 0;
        user.loginLockedUntil = null;
        await user.save();
      }

      // "Beni hatırla" işaretliyse oturum 30 gün, değilse 1 gün geçerli
      // (ikisi de kullanıldıkça uzuyor, bkz. resolveUsername).
      const token = await createSession(user.username, rememberMe === true);
      ctx.bindUser(user.username);

      // YENİ: ÇOKLU SUNUCU — artık tek bir kanal listesi değil, kullanıcının
      // erişebildiği SUNUCULARIN listesi gönderiliyor. İstemci, aktif
      // sunucuyu seçtikten sonra "server-channels" ile o sunucunun kanal
      // listesini ayrıca isteyecek.
      const userRoles = user.roles || [];
      const myServers = await getAccessibleServers(user.username, userRoles);
      const unread = await unreadByServer(user.username, userRoles, myServers);

      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        myServers: myServers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === user.username,
          ...unread.get(s._id.toString()),
        })),
        avatarData: user.avatarData || null,
        avatarUrl: user.avatarData ? avatarUrl(user.username, user.avatarUpdatedAt) : null,
        // YENİ: istemcinin "ben admin miyim (Alganis rolü var mı)"
        // kontrolünü yapıp arayüzü ona göre göstermesi için. Gerçek
        // YETKİ kontrolü her zaman sunucuda, taze bir DB okumasıyla
        // tekrar yapılıyor — bu sadece arayüz gösterimi için.
        roles: userRoles,
      });
    } catch (err) {
      console.error("Giriş sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: "Beni hatırla" ile kaydedilmiş bir oturumu devam ettirme —
  // şifre GEREKMİYOR, çünkü elindeki token zaten önceki başarılı bir
  // girişin kanıtı. Uygulama açılışında localStorage'da bir token varsa
  // istemci bunu otomatik dener; başarısız olursa (süresi dolmuş/geçersiz)
  // normal giriş ekranına döner.
  socket.on("resume-session", async ({ token }, callback) => {
    if (typeof callback !== "function") return;
    if (typeof token !== "string" || !token) return callback({ success: false });
    try {
      const session = await findSession(token);
      if (!session) return callback({ success: false });
      const user = await User.findOne({ username: session.username });
      if (!user) {
        await deleteSession(token);
        return callback({ success: false });
      }

      // Kayan pencere: aktif kullanılan bir "beni hatırla" oturumu,
      // gerçekten hiç kullanılmadığı sürece süresi dolmasın diye her
      // devam ettirmede süreyi yeniden 30 güne uzatıyoruz.
      const cached = {
        username: user.username,
        rememberMe: session.rememberMe !== false,
        expiresAt: session.expiresAt,
        refreshedAt: 0,
      };
      sessionCache.set(token, cached);
      refreshSession(token, cached);
      ctx.bindUser(user.username);

      const userRoles = user.roles || [];
      const myServers = await getAccessibleServers(user.username, userRoles);
      const unread = await unreadByServer(user.username, userRoles, myServers);

      callback({
        success: true,
        username: user.username,
        token,
        iceServers: buildIceServers(),
        myServers: myServers.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          isOwner: s.ownerUsername === user.username,
          ...unread.get(s._id.toString()),
        })),
        avatarData: user.avatarData || null,
        avatarUrl: user.avatarData ? avatarUrl(user.username, user.avatarUpdatedAt) : null,
        roles: userRoles,
      });
    } catch (err) {
      console.error("Oturum devam ettirilirken hata:", err.message);
      callback({ success: false });
    }
  });

  // ---- YENİ: Çıkış yapma — hem bellek-içi hem kalıcı (Session)
  // kaydını temizliyor, "beni hatırla" ile bir daha otomatik girmesin.
  socket.on("logout", async ({ token } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (typeof token !== "string" || !token) return reply({ success: false });
    try {
      const username = await resolveUsername(token);
      await deleteSession(token);
      if (username && username === ctx.username) await ctx.unbindUser();
      reply({ success: true });
    } catch (err) {
      console.error("Oturum silinirken hata:", err.message);
      reply({ success: false });
    }
  });

  // ---- YENİ: Kayıt olma — davet kodu ile sınırlı. Uygulamada bilerek
  // herkese açık bir kayıt formu YOKTU (bkz. add-user.js'teki eski not) —
  // çünkü sunucu adresini bulan HERKES hesap açıp en azından rol
  // gerektirmeyen kanallara (ör. Genel) girebilirdi. REGISTER_INVITE_CODE
  // ortam değişkeniyle eşleşmeyen istekler reddediliyor; kodu bilmeyen
  // biri (arkadaş grubunun dışından biri sunucu adresini bulsa bile)
  // hesap açamaz.
  socket.on("register", async ({ username, password, inviteCode }, callback) => {
    const ip = getClientIp(socket);

    // YENİ: bu IP daha önce saldırı niteliğinde davranış yüzünden
    // KALICI banlanmışsa, hiçbir şeyi kontrol etmeden AYNI genel
    // mesajla reddet — banlı olduğunu bilerek belli etmiyoruz (saldırgan
    // "engellendim" bilgisini alıp başka bir yol denemeye çalışmasın).
    if (bannedIpSet.has(ip)) {
      return callback({ success: false, message: "Davet kodu hatalı." });
    }

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      typeof inviteCode !== "string"
    ) {
      return callback({ success: false, message: "Eksik bilgi." });
    }
    const trimmedUsername = username.trim();
    if (!/^[\wÇĞİÖŞÜçğıöşü]{3,32}$/.test(trimmedUsername)) {
      return callback({
        success: false,
        message: "Kullanıcı adı 3-32 karakter olmalı, sadece harf/rakam/alt çizgi içerebilir.",
      });
    }
    if (isReservedUsername(trimmedUsername)) {
      return callback({ success: false, message: "Bu kullanıcı adı kullanılamaz." });
    }
    if (password.length < 6) {
      return callback({ success: false, message: "Şifre en az 6 karakter olmalı." });
    }
    const expectedCode = process.env.REGISTER_INVITE_CODE;
    if (!expectedCode) {
      return callback({ success: false, message: "Kayıt şu anda kapalı." });
    }
    if (inviteCode !== expectedCode) {
      // YENİ: yanlış davet kodu denemesini bu IP için say. Kısa sürede
      // (5 dakika) çok sayıda (10+) yanlış deneme = otomatik/saldırı
      // niteliğinde davranış demektir — bir insan bu kadar hızlı bu
      // kadar çok deneme yapmaz. Böyle bir durumda IP'yi KALICI banlıyoruz.
      const now = Date.now();
      const entry = registerAttemptsByIp.get(ip);
      if (!entry || now - entry.windowStart > REGISTER_ATTEMPT_WINDOW_MS) {
        registerAttemptsByIp.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count += 1;
        if (entry.count >= MAX_REGISTER_ATTEMPTS_PER_WINDOW) {
          bannedIpSet.add(ip);
          registerAttemptsByIp.delete(ip);
          try {
            await BannedIp.findOneAndUpdate(
              { ip },
              {
                ip,
                reason: "Kayıt ekranında kısa sürede çok sayıda yanlış davet kodu denemesi",
                attemptCount: entry.count,
                bannedAt: new Date(),
              },
              { upsert: true }
            );
          } catch (err) {
            console.error("IP banı kaydedilirken hata:", err.message);
          }
          console.warn(`[güvenlik] IP kalıcı banlandı: ${ip} (${entry.count} deneme)`);
          notifyAdmins("security-alert", {
            type: "ip-banned",
            ip,
            attemptCount: entry.count,
            reason: "Kayıt ekranında çok sayıda yanlış davet kodu denemesi",
          });
        }
      }
      return callback({ success: false, message: "Davet kodu hatalı." });
    }

    try {
      // Büyük/küçük harf farkıyla kopya ad da alınmış sayılıyor.
      if ((await findUsersByName(trimmedUsername)).length > 0) {
        return callback({ success: false, message: "Bu kullanıcı adı zaten alınmış." });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await User.create({ username: trimmedUsername, passwordHash, roles: [] });
      callback({ success: true });
    } catch (err) {
      console.error("Kayıt sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- YENİ: Profil fotoğrafı belirleme — KALICI (send-photo'daki
  // geçici/tek seferlik fotoğraflardan farklı olarak veritabanına
  // yazılıyor). Küçük bir base64 data URL bekliyoruz; boyutu burada
  // sınırlıyoruz ki veritabanı büyük resimlerle şişmesin (bu bir profil
  // fotoğrafı, tam çözünürlüklü bir paylaşım değil).
  socket.on("set-avatar", async ({ token, imageData, mimeType }) => {
    const username = await ctx.authenticate(token);
    if (!username) return;
    // GÜVENLİK: gerçekten bir data URI mi, beyan edilen mimeType ile
    // eşleşiyor mu — yoksa bir dış URL'yi profil fotoğrafı diye kaydedip
    // onu görecek herkesin istemcisini o adrese sessizce istek attırabilirdi.
    if (!isValidImageDataUri(imageData, mimeType) || !AVATAR_TYPES.includes(mimeType)) return;
    if (imageData.length > 700_000) {
      // ~700 bin karakter ≈ 500 KB ham veri — küçük bir profil fotoğrafı
      // için fazlasıyla yeterli.
      socket.emit("new-message", {
        username: "Sistem",
        system: true,
        text: "Profil fotoğrafı çok büyük (maksimum ~500 KB). Daha küçük bir resim dene.",
        createdAt: new Date(),
      });
      return;
    }

    try {
      const avatarUpdatedAt = new Date();
      await User.updateOne({ username }, { avatarData: imageData, avatarUpdatedAt });
      const url = avatarUrl(username, avatarUpdatedAt);
      socket.emit("avatar-saved", { avatarData: imageData, avatarUrl: url });
      // Üye listelerindeki adres değişti: sunuculardaki herkes yenilesin.
      announcePresence(socket.data.serverIds || []);

      // Şu an bulunduğu metin kanalındaki üye listesini (herkes için)
      // ve varsa ses odasındaki eş bağlantı durumunu anlık güncelle.
      if (ctx.textRoom) {
        const memberList = await buildMemberList(ctx.textRoom);
        io.to(textRoomName(ctx.textRoom)).emit("channel-members", memberList);
      }
      if (ctx.voiceRoom && voiceRooms[ctx.voiceRoom]?.[socket.id]) {
        voiceRooms[ctx.voiceRoom][socket.id].avatarUrl = url;
        socket.to(voiceRoomName(ctx.voiceRoom)).emit("user-state-update", {
          socketId: socket.id,
          state: { avatarUrl: url },
        });
      }
    } catch (err) {
      console.error("Profil fotoğrafı kaydedilirken hata:", err.message);
    }
  });
};
