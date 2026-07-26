// ============================================================
// MÜZİK BOTU
// ------------------------------------------------------------
// DENEYSEL — bu, projedeki en yeni türden kod: sunucunun kendisi
// gerçek zamanlı ses işleyip WebRTC üzerinden katılımcılara
// yayınlıyor.
//
// YouTube çekme motoru olarak artık yt-dlp kullanılıyor (Node.js
// kütüphanesi değil, ayrı bir program — Render'ın "Build Command"
// ayarında indiriliyor, bkz. README/talimatlar). Bu, en aktif
// güncellenen, YouTube'un sık değişen savunmasına en hızlı
// yetişen araç.
//
// Bot, gerçek bir Socket.io bağlantısı DEĞİL — sunucu sürecinin
// içinde yaşayan "sahte bir katılımcı". Gerçek kullanıcıların
// istemcisi, botu normal bir kişi gibi algılıyor (aynı
// 'voice-user-joined' / 'signal' mekanizması üzerinden).
// ============================================================

const { RTCPeerConnection, MediaStreamTrack, RTCRtpCodecParameters } = require("werift");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const prism = require("prism-media");
const ffmpegPath = require("ffmpeg-static");

const BOT_NAME = process.env.BOT_NAME || "DJ Dikkat";
const BOT_SOCKET_PREFIX = "bot-voice::";

// yt-dlp ikili dosyası, Render'ın Build Command'ı sırasında bu
// klasöre indiriliyor (bkz. kurulum talimatları). __dirname
// kullanıyoruz ki çalıştığı klasör ne olursa olsun doğru yeri bulsun.
const YTDLP_PATH = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
if (!fs.existsSync(YTDLP_PATH)) {
  console.warn(
    `UYARI: yt-dlp bulunamadı (${YTDLP_PATH}) — Render'ın Build Command'ına indirme adımını eklediğinden emin ol, yoksa müzik botu çalışmaz.`
  );
}

// YENİ: YouTube, bulut sunucularından gelen otomatik istekleri
// engelleyebiliyor — giriş yapmış bir hesabın çerezlerini kullanmak
// bunu büyük ölçüde azaltıyor. YOUTUBE_COOKIES ortam değişkeni JSON
// formatında (tarayıcı eklentisinin ürettiği hal) geliyor, yt-dlp
// ise "Netscape" formatında bir dosya bekliyor — burada birini
// diğerine çeviriyoruz.
let cookiesFilePath;
if (process.env.YOUTUBE_COOKIES) {
  try {
    const cookies = JSON.parse(process.env.YOUTUBE_COOKIES);
    const lines = ["# Netscape HTTP Cookie File"];
    cookies.forEach((c) => {
      const domain = c.domain?.startsWith(".") ? c.domain : `.${c.domain || "youtube.com"}`;
      const path_ = c.path || "/";
      const secure = c.secure ? "TRUE" : "FALSE";
      const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 2147483647;
      lines.push([domain, "TRUE", path_, secure, expiry, c.name, c.value].join("\t"));
    });
    cookiesFilePath = path.join(os.tmpdir(), "yt-cookies.txt");
    fs.writeFileSync(cookiesFilePath, lines.join("\n"));
    console.log("YouTube çerezleri yt-dlp için hazırlandı (bot için).");
  } catch (err) {
    console.error("UYARI: YOUTUBE_COOKIES işlenemedi:", err.message);
  }
} else {
  console.warn(
    "UYARI: YOUTUBE_COOKIES ayarlanmamış — bot YouTube'un bot-engeline takılabilir."
  );
}

const OPUS_CODEC = new RTCRtpCodecParameters({
  mimeType: "audio/opus",
  clockRate: 48000,
  channels: 2,
});

// YENİ: video'yu "inactive" (kapalı) bıraksak bile, müzakerenin
// tamamlanabilmesi için EN AZ bir video codec'i tanımlı olması
// gerekiyor — yoksa "negotiate codecs failed" hatası alınıyor
// (bunu gerçek bir müzakere testiyle bulup doğruladım).
const VP8_CODEC = new RTCRtpCodecParameters({
  mimeType: "video/VP8",
  clockRate: 90000,
});

// ---- yt-dlp'ye bir arama sorgusu YA DA doğrudan bir link verip,
// video adresini + başlığını almak için ortak fonksiyon. ----
function resolveVideo(query) {
  const isUrl = /^https?:\/\//i.test(query);
  const target = isUrl ? query : `ytsearch1:${query}`;

  return new Promise((resolve, reject) => {
    const args = ["--dump-single-json", "--no-warnings", "--flat-playlist"];
    if (cookiesFilePath) args.push("--cookies", cookiesFilePath);
    args.push(target);

    const proc = spawn(YTDLP_PATH, args);
    let output = "";
    let errorOutput = "";
    proc.stdout.on("data", (chunk) => (output += chunk));
    proc.stderr.on("data", (chunk) => (errorOutput += chunk.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(errorOutput.slice(-500) || `yt-dlp çıkış kodu ${code}`));
      }
      try {
        const parsed = JSON.parse(output);
        // Arama sonucu bir "playlist" gibi entries içinde gelir,
        // doğrudan link ise ayrıştırılan nesnenin KENDİSİ video bilgisidir.
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
    proc.on("error", (err) => reject(err));
  });
}

// ---- yt-dlp (ham ses çeker) -> ffmpeg (garanti webm/opus'a çevirir)
// zinciri kuruyor. İkisini birbirine pipe ediyoruz. ----
function startAudioProcess(videoUrl, channel) {
  const ytdlpArgs = ["-f", "bestaudio", "-o", "-", "--no-warnings"];
  if (cookiesFilePath) ytdlpArgs.push("--cookies", cookiesFilePath);
  ytdlpArgs.push(videoUrl);

  // YENİ (kesin teşhis): tam bu anda çerez dosyası GERÇEKTEN var mı,
  // kaç satır içeriyor — tahmin etmeyelim, direkt görelim.
  if (cookiesFilePath) {
    try {
      const stat = fs.statSync(cookiesFilePath);
      const lineCount = fs.readFileSync(cookiesFilePath, "utf-8").split("\n").length;
      console.log(
        `[bot/${channel}] Çerez dosyası kullanılıyor: ${cookiesFilePath} (${stat.size} bayt, ${lineCount} satır)`
      );
    } catch (err) {
      console.error(`[bot/${channel}] UYARI: çerez dosyası OKUNAMADI:`, err.message);
    }
  } else {
    console.warn(`[bot/${channel}] UYARI: cookiesFilePath tanımsız — çerezsiz deneniyor.`);
  }

  const ytdlpProc = spawn(YTDLP_PATH, ytdlpArgs);
  const ffmpegProc = spawn(ffmpegPath, [
    "-i", "pipe:0",
    "-f", "webm",
    "-c:a", "libopus",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ]);

  ytdlpProc.stdout.pipe(ffmpegProc.stdin);

  let ytdlpErrorTail = "";
  ytdlpProc.stderr.on("data", (chunk) => {
    ytdlpErrorTail = (ytdlpErrorTail + chunk.toString()).slice(-1500);
  });
  ytdlpProc.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[bot/${channel}] yt-dlp çıkış kodu ${code}:\n${ytdlpErrorTail}`);
    }
  });
  ytdlpProc.on("error", (err) => {
    console.error(`[bot/${channel}] yt-dlp başlatılamadı:`, err.message);
  });

  let ffmpegErrorTail = "";
  ffmpegProc.stderr.on("data", (chunk) => {
    ffmpegErrorTail = (ffmpegErrorTail + chunk.toString()).slice(-1500);
  });
  ffmpegProc.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[bot/${channel}] ffmpeg çıkış kodu ${code}:\n${ffmpegErrorTail}`);
    }
  });
  ffmpegProc.on("error", (err) => {
    console.error(`[bot/${channel}] ffmpeg başlatılamadı:`, err.message);
  });

  return { ytdlpProc, ffmpegProc, audioStream: ffmpegProc.stdout };
}

function createMusicBot({ io, voiceRooms, textRoomName, voiceRoomName, buildMemberList }) {
  // channel -> { peerConnections: Map<realSocketId, {pc, sender}>, currentProcess, inVoice }
  const channelState = new Map();

  function getOrCreateChannelState(channel) {
    if (!channelState.has(channel)) {
      channelState.set(channel, {
        peerConnections: new Map(),
        currentProcess: null,
        inVoice: false,
      });
    }
    return channelState.get(channel);
  }

  function botSocketId(channel) {
    return `${BOT_SOCKET_PREFIX}${channel}`;
  }

  // ---- Botun bir gerçek katılımcıya (yeni ya da zaten sesteyken
  // gelen bir teklife karşılık) bağlantı kurması. ----
  function createConnectionToPeer(channel, realSocketId) {
    const state = getOrCreateChannelState(channel);
    const pc = new RTCPeerConnection({
      codecs: { audio: [OPUS_CODEC], video: [VP8_CODEC] },
    });

    const track = new MediaStreamTrack({ kind: "audio" });
    // Gerçek kullanıcıların bağlantısı hem ses hem görüntü yuvası
    // açıyor (recvonly) — botun cevabı bu iki yuvaya da denk düşen
    // bir yapıda olmalı, yoksa SDP uyumsuzluğu olur. Bot'un görüntüsü
    // yok, o yüzden video'yu "inactive" bırakıyoruz.
    const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
    pc.addTransceiver("video", { direction: "inactive" });

    pc.onicecandidate = (candidate) => {
      if (candidate) {
        io.to(realSocketId).emit("signal", {
          from: botSocketId(channel),
          data: { type: "ice-candidate", candidate, connectionType: "main" },
        });
      }
    };

    // sender.sendRtp: ham ses verisini (Opus payload) alıp doğru RTP
    // paketleme (sıra numarası, zaman damgası, payload type) işini
    // KENDİSİ otomatik yapıyor.
    state.peerConnections.set(realSocketId, { pc, sender: transceiver.sender });

    return { pc, sender: transceiver.sender };
  }

  // ---- Gerçek bir kullanıcıdan gelen sinyali (offer/answer/ice) işler. ----
  async function handleIncomingSignal(channel, fromSocketId, data) {
    if (data.connectionType && data.connectionType !== "main") return; // ekran paylaşımıyla ilgilenmiyoruz

    const state = getOrCreateChannelState(channel);
    let entry = state.peerConnections.get(fromSocketId);
    if (!entry) {
      entry = createConnectionToPeer(channel, fromSocketId);
    }
    const { pc } = entry;

    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        io.to(fromSocketId).emit("signal", {
          from: botSocketId(channel),
          data: { type: "answer", sdp: pc.localDescription, connectionType: "main" },
        });
      } else if (data.type === "ice-candidate") {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (err) {
      console.error(`[bot/${channel}] sinyal işlenirken hata:`, err.message);
    }
  }

  // ---- Bot sese katılıyor: sanal katılımcı olarak voiceRooms'a
  // eklenir, mevcut herkese "yeni katılımcı" olarak duyurulur. ----
  async function joinVoice(channel) {
    const state = getOrCreateChannelState(channel);
    if (state.inVoice) return;
    state.inVoice = true;

    if (!voiceRooms[channel]) voiceRooms[channel] = {};
    voiceRooms[channel][botSocketId(channel)] = {
      username: BOT_NAME,
      muted: false,
      cameraOn: false,
      sharingScreen: false,
      isBot: true,
    };

    io.to(voiceRoomName(channel)).emit("voice-user-joined", {
      socketId: botSocketId(channel),
      username: BOT_NAME,
      muted: false,
      cameraOn: false,
      sharingScreen: false,
      isBot: true,
    });

    const memberList = await buildMemberList(channel);
    io.to(textRoomName(channel)).emit("channel-members", memberList);
  }

  // ---- Bot sesten çıkıyor: tüm bağlantıları kapatır, çalan şarkı
  // varsa durdurur. ----
  async function leaveVoice(channel) {
    const state = channelState.get(channel);
    if (!state || !state.inVoice) return;

    stopSong(channel);
    state.peerConnections.forEach(({ pc }) => pc.close());
    state.peerConnections.clear();
    state.inVoice = false;

    if (voiceRooms[channel]) {
      delete voiceRooms[channel][botSocketId(channel)];
    }
    io.to(voiceRoomName(channel)).emit("voice-user-left", { socketId: botSocketId(channel) });

    const memberList = await buildMemberList(channel);
    io.to(textRoomName(channel)).emit("channel-members", memberList);
  }

  // ---- YouTube'dan (yt-dlp ile) şarkı arayıp çalar. ----
  async function playSong(channel, query) {
    const state = getOrCreateChannelState(channel);
    if (!state.inVoice) {
      await joinVoice(channel);
    }
    stopSong(channel); // önceki şarkı varsa durdur

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

    const { ytdlpProc, ffmpegProc, audioStream } = startAudioProcess(resolved.url, channel);
    const demuxer = new prism.opus.WebmDemuxer();
    audioStream.pipe(demuxer);

    state.currentProcess = { ytdlpProc, ffmpegProc, demuxer };
    state._loggedSendError = false;

    demuxer.on("error", (err) => {
      console.error(`[bot/${channel}] ses ayrıştırma hatası:`, err.message);
    });

    // YENİ (teşhis): boru hattının GERÇEKTEN veri üretip üretmediğini
    // ve o veriyi göndermeye çalışırken hata olup olmadığını görelim
    // — önceden hatalar sessizce yutuluyordu.
    let firstPacketLogged = false;
    demuxer.on("data", (opusPacket) => {
      if (!firstPacketLogged) {
        firstPacketLogged = true;
        console.log(
          `[bot/${channel}] İlk ses paketi üretildi (${opusPacket.length} bayt). Şu an ${state.peerConnections.size} bağlantıya gönderiliyor.`
        );
      }
      state.peerConnections.forEach(({ pc, sender }, peerSocketId) => {
        try {
          sender.sendRtp(opusPacket);
        } catch (err) {
          if (!state._loggedSendError) {
            state._loggedSendError = true;
            console.error(
              `[bot/${channel}] ${peerSocketId} bağlantı durumu: ${pc.connectionState}, ICE: ${pc.iceConnectionState} — gönderim hatası:`,
              err.message
            );
          }
        }
      });
    });

    demuxer.on("end", () => {
      state.currentProcess = null;
    });

    io.to(textRoomName(channel)).emit("new-message", {
      username: BOT_NAME,
      text: `▶️ Şimdi çalıyor: ${resolved.title}`,
      createdAt: new Date(),
    });
  }

  function stopSong(channel, { announce = false } = {}) {
    const state = channelState.get(channel);
    if (!state?.currentProcess) {
      if (announce) {
        io.to(textRoomName(channel)).emit("new-message", {
          username: BOT_NAME,
          text: "Zaten çalan bir şey yok.",
          createdAt: new Date(),
        });
      }
      return;
    }
    const { ytdlpProc, ffmpegProc, demuxer } = state.currentProcess;
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
    try {
      demuxer.destroy();
    } catch {
      /* zaten kapanmış olabilir */
    }
    state.currentProcess = null;
    if (announce) {
      io.to(textRoomName(channel)).emit("new-message", {
        username: BOT_NAME,
        text: "⏹️ Durduruldu.",
        createdAt: new Date(),
      });
    }
  }

  // ---- Sohbete yazılan bir komutu işler. "true" dönerse, bu mesaj
  // bir bot komutuydu demektir. ----
  async function handleChatCommand(channel, text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("!")) return false;

    const [rawCommand, ...rest] = trimmed.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const query = rest.join(" ");

    try {
      if (command === "!katıl" || command === "!gel") {
        await joinVoice(channel);
      } else if (command === "!ayrıl" || command === "!çık") {
        await leaveVoice(channel);
      } else if (command === "!çal" || command === "!play") {
        if (!query) return true;
        await playSong(channel, query);
      } else if (command === "!durdur" || command === "!dur") {
        stopSong(channel, { announce: true });
      } else {
        return false; // bilinmeyen komut, normal mesaj gibi davran
      }
    } catch (err) {
      console.error(
        `[bot/${channel}] komut işlenirken hata (komut: "${trimmed}"):`,
        err.stack || err.message
      );
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
    botSocketId,
    handleIncomingSignal,
    handleChatCommand,
  };
}

module.exports = { createMusicBot, BOT_NAME, BOT_SOCKET_PREFIX };
