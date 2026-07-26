// ============================================================
// MÜZİK BOTU (v2 — istemci-üzerinden yayın mimarisi)
// ------------------------------------------------------------
// YENİ MİMARİ: Sunucu artık kendi başına bir WebRTC katılımcısı
// DEĞİL — bu, önceki sürümde çözemediğimiz bağlantı sorunlarının
// kaynağıydı. Bunun yerine:
//   1) Sunucu YouTube'dan sesi çekip (yt-dlp+ffmpeg, zaten sağlam
//      çalışan kısım) kendi HTTP adresinden YAYINLIYOR.
//   2) Komutu yazan (ZATEN seste olan) kişinin istemcisine "şu
//      adresi çal" diyor.
//   3) O kişinin istemcisi, müziği KENDİ (zaten çalışan, defalarca
//      test edilmiş) ses bağlantısına karıştırıyor.
// Bu sayede sunucu tarafında hiç WebRTC/DTLS karmaşası kalmıyor.
// ============================================================

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const BOT_NAME = process.env.BOT_NAME || "DJ Dikkat";

const YTDLP_PATH = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
if (!fs.existsSync(YTDLP_PATH)) {
  console.warn(
    `UYARI: yt-dlp bulunamadı (${YTDLP_PATH}) — Render'ın Build Command'ına indirme adımını eklediğinden emin ol, yoksa müzik botu çalışmaz.`
  );
}

let RAW_COOKIES = null;
if (process.env.YOUTUBE_COOKIES) {
  try {
    RAW_COOKIES = JSON.parse(process.env.YOUTUBE_COOKIES);
    console.log(`YouTube çerezleri ayrıştırıldı (${RAW_COOKIES.length} çerez, bot için).`);
  } catch (err) {
    console.error("UYARI: YOUTUBE_COOKIES ayrıştırılamadı:", err.message);
  }
} else {
  console.warn("UYARI: YOUTUBE_COOKIES ayarlanmamış — bot YouTube'un bot-engeline takılabilir.");
}

// Her çağrıda TAZE, BENZERSİZ bir çerez dosyası üretir (yt-dlp'nin
// önceki çağrıda dosyayı değiştirmiş olmasından etkilenmesin diye —
// bunu canlı testlerde gerçek bir sorun olarak bulmuştuk).
function writeFreshCookiesFile() {
  if (!RAW_COOKIES) return { filePath: null, cleanup: () => {} };
  try {
    const lines = ["# Netscape HTTP Cookie File"];
    RAW_COOKIES.forEach((c) => {
      const domain = c.domain?.startsWith(".") ? c.domain : `.${c.domain || "youtube.com"}`;
      const path_ = c.path || "/";
      const secure = c.secure ? "TRUE" : "FALSE";
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 2147483647;
      lines.push([domain, "TRUE", path_, secure, expiry, c.name, c.value].join("\t"));
    });
    const filePath = path.join(
      os.tmpdir(),
      `yt-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );
    fs.writeFileSync(filePath, lines.join("\n"));
    return {
      filePath,
      cleanup: () => {
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* zaten silinmiş olabilir */
        }
      },
    };
  } catch (err) {
    console.error("UYARI: çerez dosyası yazılamadı:", err.message);
    return { filePath: null, cleanup: () => {} };
  }
}

// ---- yt-dlp'ye bir arama sorgusu YA DA doğrudan bir link verip,
// video adresini + başlığını almak için ortak fonksiyon. ----
function resolveVideo(query) {
  const isUrl = /^https?:\/\//i.test(query);
  const target = isUrl ? query : `ytsearch1:${query}`;
  const { filePath: cookiesFile, cleanup } = writeFreshCookiesFile();

  return new Promise((resolve, reject) => {
    const args = ["--dump-single-json", "--no-warnings", "--flat-playlist"];
    if (cookiesFile) args.push("--cookies", cookiesFile);
    args.push(target);

    const proc = spawn(YTDLP_PATH, args);
    let output = "";
    let errorOutput = "";
    proc.stdout.on("data", (chunk) => (output += chunk));
    proc.stderr.on("data", (chunk) => (errorOutput += chunk.toString()));
    proc.on("close", (code) => {
      cleanup();
      if (code !== 0) {
        return reject(new Error(errorOutput.slice(-500) || `yt-dlp çıkış kodu ${code}`));
      }
      try {
        const parsed = JSON.parse(output);
        const videoInfo = parsed.entries ? parsed.entries[0] : parsed;
        if (!videoInfo) return resolve(null);
        resolve({
          url: videoInfo.webpage_url || videoInfo.url || target,
          title: videoInfo.title || query,
        });
      } catch (err) {
        reject(new Error(`yt-dlp çıktısı ayrıştırılamadı: ${err.message}`));
      }
    });
    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

// ---- Bir video adresi için, sesi anlık olarak (yt-dlp -> ffmpeg
// zinciriyle) bir HTTP yanıtına akıtır. Bu fonksiyon server.js'teki
// HTTP endpoint tarafından çağrılıyor. ----
function streamAudioToResponse(videoUrl, res) {
  const { filePath: cookiesFile, cleanup } = writeFreshCookiesFile();
  const ytdlpArgs = ["-f", "bestaudio", "-o", "-", "--no-warnings"];
  if (cookiesFile) ytdlpArgs.push("--cookies", cookiesFile);
  ytdlpArgs.push(videoUrl);

  const ytdlpProc = spawn(YTDLP_PATH, ytdlpArgs);
  const ffmpegProc = spawn(ffmpegPathSafe(), [
    "-i", "pipe:0",
    "-f", "webm",
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ]);

  ytdlpProc.stdout.pipe(ffmpegProc.stdin);
  ffmpegProc.stdout.pipe(res);

  // EPIPE gibi hataları sessizce (ama loglayarak) yönet — istemci
  // bağlantıyı erken keserse (ör. şarkıyı durdurunca) bu normaldir.
  ffmpegProc.stdin.on("error", () => {});
  ytdlpProc.stdout.on("error", () => {});
  ffmpegProc.stdout.on("error", () => {});

  let ytdlpErrorTail = "";
  ytdlpProc.stderr.on("data", (chunk) => {
    ytdlpErrorTail = (ytdlpErrorTail + chunk.toString()).slice(-1000);
  });
  ytdlpProc.on("close", (code) => {
    cleanup();
    if (code !== 0 && code !== null) {
      console.error(`[bot-audio] yt-dlp çıkış kodu ${code}:\n${ytdlpErrorTail}`);
    }
  });

  const cleanupProcesses = () => {
    try {
      ytdlpProc.kill("SIGKILL");
    } catch {
      /* zaten kapanmış olabilir */
    }
    try {
      ffmpegProc.kill("SIGKILL");
    } catch {
      /* zaten kapanmış olabilir */
    }
  };
  res.on("close", cleanupProcesses);

  return cleanupProcesses;
}

// ffmpeg-static'i lazy require ediyoruz (server.js zaten import ediyor
// olabilir, döngüsel bağımlılığı önlemek için burada ayrı tutuyoruz).
let _ffmpegPath;
function ffmpegPathSafe() {
  if (!_ffmpegPath) _ffmpegPath = require("ffmpeg-static");
  return _ffmpegPath;
}

function createMusicBot({ io, textRoomName, isUserInVoice }) {
  // channel -> { hostSocketId, title }  — o an kimin üzerinden
  // müzik çaldığı (varsa).
  const channelState = new Map();

  function getState(channel) {
    if (!channelState.has(channel)) {
      channelState.set(channel, { hostSocketId: null, title: null });
    }
    return channelState.get(channel);
  }

  async function playSong(channel, query, requesterSocketId) {
    if (!isUserInVoice(channel, requesterSocketId)) {
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: "Önce sese katılman lazım, öyle çalabilirim.",
        createdAt: new Date(),
      });
      return;
    }

    let resolved;
    try {
      resolved = await resolveVideo(query);
    } catch (err) {
      console.error(`[bot/${channel}] video bulunurken hata:`, err.message);
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: "Bir sorun oldu, tekrar dener misin?",
        createdAt: new Date(),
      });
      return;
    }
    if (!resolved) {
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: `"${query}" için bir şey bulamadım.`,
        createdAt: new Date(),
      });
      return;
    }

    const state = getState(channel);
    state.hostSocketId = requesterSocketId;
    state.title = resolved.title;

    const streamUrl = `/bot-audio?url=${encodeURIComponent(resolved.url)}&t=${Date.now()}`;
    io.to(requesterSocketId).emit("bot-play", { streamUrl, title: resolved.title });

    io.to(textRoomName(channel)).emit("new-message", {
      username: BOT_NAME,
      text: `▶️ Şimdi çalıyor: ${resolved.title}`,
      createdAt: new Date(),
    });
  }

  function stopSong(channel, { announce = false } = {}) {
    const state = channelState.get(channel);
    if (!state?.hostSocketId) {
      if (announce) {
        io.to(textRoomName(channel)).emit("new-message", {
          username: BOT_NAME,
          text: "Zaten çalan bir şey yok.",
          createdAt: new Date(),
        });
      }
      return;
    }
    io.to(state.hostSocketId).emit("bot-stop");
    state.hostSocketId = null;
    state.title = null;
    if (announce) {
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: "⏹️ Durduruldu.",
        createdAt: new Date(),
      });
    }
  }

  // Host kişi sesten/kanaldan ayrılırsa çalmayı da bilgi amaçlı durdur.
  function handleHostDisconnected(channel, socketId) {
    const state = channelState.get(channel);
    if (state?.hostSocketId === socketId) {
      state.hostSocketId = null;
      state.title = null;
    }
  }

  async function handleChatCommand(channel, text, fromSocketId) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("!")) return false;

    const [rawCommand, ...rest] = trimmed.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const query = rest.join(" ");

    try {
      if (command === "!çal" || command === "!play") {
        if (!query) return true;
        await playSong(channel, query, fromSocketId);
      } else if (command === "!durdur" || command === "!dur") {
        stopSong(channel, { announce: true });
      } else {
        return false;
      }
    } catch (err) {
      console.error(`[bot/${channel}] komut hatası ("${trimmed}"):`, err.stack || err.message);
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: "Bir şeyler ters gitti, tekrar dener misin?",
        createdAt: new Date(),
      });
    }
    return true;
  }

  return {
    BOT_NAME,
    handleChatCommand,
    handleHostDisconnected,
    streamAudioToResponse,
  };
}

module.exports = { createMusicBot, BOT_NAME };
