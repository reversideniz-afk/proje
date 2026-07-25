// ============================================================
// SİNYALLEŞME SUNUCUSU (Signaling Server)
// ------------------------------------------------------------
// Bu sunucu SES/GÖRÜNTÜ VERİSİ TAŞIMIYOR. Sadece kullanıcıların
// birbirini bulmasını ve WebRTC bağlantı kurma mesajlarını
// (offer/answer/ice candidate) karşı tarafa iletmeyi sağlıyor.
// Gerçek ses/görüntü/ekran akışı, bağlantı kurulduktan sonra
// doğrudan cihazlar arasında (peer-to-peer) gidiyor.
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const { connectDB, User } = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Geliştirme aşamasında serbest; canlıya alırken kısıtlanabilir.
  },
});

const PORT = process.env.PORT || 3001;

// YENİ (güvenlik): Artık TEK bir oda şifresi yerine, HER KANALIN
// KENDİ şifresi var. Hiçbiri koda yazılmıyor — Render'ın Environment
// panelinden ayarlanıyor. Bir kanalın şifresi ayarlanmamışsa, o kanal
// şifresiz kalır (uyarı basıyoruz ki unutulmuş olduğunu fark edelim).
const CHANNEL_SECRETS = {
  Genel: process.env.CHANNEL_SECRET_GENEL,
  Oyun: process.env.CHANNEL_SECRET_OYUN,
  Müzik: process.env.CHANNEL_SECRET_MUZIK,
};
Object.entries(CHANNEL_SECRETS).forEach(([channel, secret]) => {
  if (!secret) {
    console.warn(`UYARI: "${channel}" kanalı için şifre ayarlanmamış — şifresiz girilebilir!`);
  }
});

// Veritabanına bağlan (kişisel hesaplar için).
connectDB();

// NOT: Artık statik dosya sunmuyoruz — istemci (client) bir Electron masaüstü
// uygulaması, tarayıcıdan açılan bir web sayfası değil. Bu sunucunun tek işi
// Socket.io üzerinden sinyalleşme (bkz. dosya başındaki açıklama).

// Basit bir "sunucu ayakta mı" kontrolü için (tarayıcıdan test edebilmen için)
app.get("/", (req, res) => {
  res.send("Sinyalleşme sunucusu çalışıyor. Bu bir web sayfası değil, sadece durum kontrolü.");
});

// ------------------------------------------------------------
// ODA DURUMU (bellekte tutuluyor — basit tutmak için DB yok)
// rooms = {
//   "oda-kodu": {
//     "socketId": { displayName, muted, cameraOn, sharingScreen }
//   }
// }
// ------------------------------------------------------------
const rooms = {};

function getRoomUsers(roomId) {
  return rooms[roomId] || {};
}

function removeUserFromRoom(roomId, socketId) {
  if (rooms[roomId]) {
    delete rooms[roomId][socketId];
    if (Object.keys(rooms[roomId]).length === 0) {
      delete rooms[roomId];
    }
  }
}

io.on("connection", (socket) => {
  let currentRoom = null;

  // ---- YENİ: Kişisel hesap girişi ----
  // Kanal seçmeden ÖNCE, kullanıcı adı/şifre doğrulanıyor. "callback"
  // kullanıyoruz (Socket.io'nun "acknowledgement" özelliği) — bu, normal
  // bir fonksiyon çağrısı gibi doğrudan cevap almamızı sağlıyor, ayrı
  // bir olay dinlemeye gerek kalmıyor.
  socket.on("login", async ({ username, password }, callback) => {
    if (!username || !password) {
      return callback({ success: false, message: "Kullanıcı adı ve şifre gerekli." });
    }
    try {
      const user = await User.findOne({ username: username.trim() });
      // Kasıtlı olarak "kullanıcı yok" ile "şifre yanlış" durumlarında
      // AYNI mesajı veriyoruz — hangisinin doğru olduğunu belli etmemek
      // için (biri "bu kullanıcı adı var mı" diye deneme yapamasın).
      if (!user) {
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }
      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        return callback({ success: false, message: "Kullanıcı adı veya şifre hatalı." });
      }
      callback({ success: true, username: user.username });
    } catch (err) {
      console.error("Giriş sırasında hata:", err.message);
      callback({ success: false, message: "Sunucu hatası, tekrar dene." });
    }
  });

  // ---- Odaya katılma ----
  socket.on("join-room", ({ roomId, displayName, secret }) => {
    if (!roomId || !displayName) return;

    // YENİ (güvenlik): bu KANALA özel şifre kontrolü.
    const expectedSecret = CHANNEL_SECRETS[roomId];
    if (expectedSecret && secret !== expectedSecret) {
      socket.emit("join-error", "Yanlış kanal şifresi.");
      return;
    }

    currentRoom = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = {
      displayName,
      muted: true,
      cameraOn: false,
      sharingScreen: false,
    };

    // Yeni katılan kişiye, odadaki mevcut herkesin listesini gönder.
    // (Mesh topolojisinde herkes herkesle direkt bağlantı kuracak.)
    const existingUsers = Object.entries(getRoomUsers(roomId))
      .filter(([id]) => id !== socket.id)
      .map(([id, info]) => ({ socketId: id, ...info }));

    socket.emit("existing-users", existingUsers);

    // Odadaki diğer herkese yeni kullanıcıyı bildir (mikrofon/kamera
    // durumu dahil — tek doğru kaynak: az önce oluşturduğumuz oda kaydı).
    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
      ...rooms[roomId][socket.id],
    });
  });

  // ---- WebRTC sinyal mesajlarını ilet (offer / answer / ice candidate) ----
  // 'data' içeriği client tarafında belirleniyor, sunucu içeriğe bakmadan
  // sadece hedef socket'e iletiyor.
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", {
      from: socket.id,
      data,
    });
  });

  // ---- Mikrofon / kamera / ekran paylaşımı durum güncellemesi ----
  // (Diğer katılımcıların arayüzünde ikon güncellemek için)
  socket.on("state-update", (partialState) => {
    if (!currentRoom || !rooms[currentRoom]?.[socket.id]) return;
    Object.assign(rooms[currentRoom][socket.id], partialState);
    socket.to(currentRoom).emit("user-state-update", {
      socketId: socket.id,
      state: partialState,
    });
  });

  // ---- Ayrılma ----
  socket.on("disconnect", () => {
    if (currentRoom) {
      removeUserFromRoom(currentRoom, socket.id);
      socket.to(currentRoom).emit("user-left", { socketId: socket.id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Sinyalleşme sunucusu ${PORT} portunda çalışıyor.`);
});
