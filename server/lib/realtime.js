// Express uygulaması, HTTP sunucusu ve Socket.IO sunucusu (tek örnek).
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // Geliştirme aşamasında serbest; canlıya alırken kısıtlanabilir.
  },
  // Tek bir paket en fazla 1 MB. Eskiden fotoğraflar yüzünden 15 MB'tı ve
  // bu sınır giriş yapmamış biri dahil bütün olaylara uygulanıyordu (H8);
  // fotoğraflar artık HTTP'den geliyor (bkz. /api/photos).
  maxHttpBufferSize: 1024 * 1024,
});

module.exports = { app, httpServer, io };
