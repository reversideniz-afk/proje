// Socket.IO bağlantıları: el sıkışmada kimlik doğrulama ve her bağlantıya
// olay işleyicilerinin bağlanması.
const { io } = require("../lib/realtime");
const { resolveUsername } = require("../lib/sessions");
const { createConnectionContext } = require("./context");
const registerAccountHandlers = require("./account");
const registerServerHandlers = require("./servers");
const registerChannelHandlers = require("./channels");
const registerVoiceHandlers = require("./voice");
const registerAdminHandlers = require("./admin");
const registerRoleHandlers = require("./roles");

// Bağlantı kurulurken (el sıkışmada) gönderilen oturum anahtarı geçerliyse
// bağlantı o kullanıcıya bağlanıyor; olaylarda ayrıca anahtar gerekmiyor.
// Anahtarsız bağlantı da kabul ediliyor (giriş/kayıt ekranı ve henüz
// güncellenmemiş, her olayda anahtar gönderen istemciler için).
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token === "string" && token) {
    const username = await resolveUsername(token);
    if (username) socket.data.username = username;
  }
  next();
});

// Her bağlantı için durum nesnesi (ctx) kurulup olay grupları bağlanıyor.
io.on("connection", (socket) => {
  const ctx = createConnectionContext(socket);
  registerAccountHandlers(socket, ctx);
  registerServerHandlers(socket, ctx);
  registerChannelHandlers(socket, ctx);
  registerVoiceHandlers(socket, ctx);
  registerAdminHandlers(socket, ctx);
  registerRoleHandlers(socket, ctx);
});
