// ============================================================
// MÜZİK BOTU
// ------------------------------------------------------------
// DENEYSEL — bu, projedeki en yeni türden kod: sunucunun kendisi
// gerçek zamanlı ses işleyip WebRTC üzerinden katılımcılara
// yayınlıyor. Diğer özelliklerin aksine, YouTube'a ve gerçek
// tarayıcı bağlantısına ihtiyaç duyduğu için bunu sandbox'ımda
// uçtan uca test edemedim — ilk canlı testlerde ince ayar
// gerekebilir.
//
// Bot, gerçek bir Socket.io bağlantısı DEĞİL — sunucu sürecinin
// içinde yaşayan "sahte bir katılımcı". Gerçek kullanıcıların
// istemcisi, botu normal bir kişi gibi algılıyor (aynı
// 'voice-user-joined' / 'signal' mekanizması üzerinden).
// ============================================================

const { RTCPeerConnection, MediaStreamTrack, RTCRtpCodecParameters } = require("werift");
const ytdl = require("@distube/ytdl-core");
const ytsr = require("@distube/ytsr");
const prism = require("prism-media");

const BOT_NAME = process.env.BOT_NAME || "DJ Dikkat";
const BOT_SOCKET_PREFIX = "bot-voice::";

// YENİ: YouTube, Render gibi bulut sunucularından gelen otomatik
// istekleri "bot" olarak işaretleyip engelliyor. Bunu aşmak için,
// giriş yapmış gerçek bir YouTube hesabının çerezlerini kullanıyoruz
// — bu, isteklerin "gerçek bir kullanıcıdan" geliyormuş gibi
// görünmesini sağlıyor. YOUTUBE_COOKIES ortam değişkeni ayarlı
// değilse, bot yine çalışmaya çalışır ama YouTube'un engeline takılma
// ihtimali yüksek kalır.
let ytdlAgent;
if (process.env.YOUTUBE_COOKIES) {
  try {
    const cookies = JSON.parse(process.env.YOUTUBE_COOKIES);
    ytdlAgent = ytdl.createAgent(cookies);
    console.log("YouTube çerezleri yüklendi (bot için).");
  } catch (err) {
    console.error("UYARI: YOUTUBE_COOKIES ayrıştırılamadı:", err.message);
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

function createMusicBot({ io, voiceRooms, textRoomName, voiceRoomName, buildMemberList }) {
  // channel -> { peerConnections: Map<realSocketId, {mainPc, track}>, currentProcess, audioTrack }
  const channelState = new Map();

  function getOrCreateChannelState(channel) {
    if (!channelState.has(channel)) {
      channelState.set(channel, {
        peerConnections: new Map(),
        currentProcess: null,
        audioTrack: null,
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
    // bir yapıda olmalı, yoksa SDP uyumsuzluğu olur (bu projede daha
    // önce tam bu tür bir hatayla karşılaşmıştık). Bot'un görüntüsü
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

    // ÖNEMLİ: writeRtp yerine artık transceiver.sender.sendRtp
    // kullanıyoruz — bu, ham ses verisini (Opus payload) alıp doğru
    // RTP paketleme (sıra numarası, zaman damgası, payload type)
    // işini KENDİSİ otomatik yapıyor. İlk denemede writeRtp'ye ham
    // veri vermek işe yaramamıştı (RTP başlığı eksik kalıyordu).
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

  // ---- YouTube'dan şarkı arayıp çalar. ----
  async function playSong(channel, query) {
    const state = getOrCreateChannelState(channel);
    if (!state.inVoice) {
      await joinVoice(channel);
    }
    stopSong(channel); // önceki şarkı varsa durdur

    let videoUrl = query;
    if (!ytdl.validateURL(query)) {
      const results = await ytsr(query, { limit: 1 });
      const firstVideo = results.items.find((item) => item.type === "video");
      if (!firstVideo) {
        io.to(textRoomName(channel)).emit("new-message", {
          username: BOT_NAME,
          text: `"${query}" için bir şey bulamadım.`,
          createdAt: new Date(),
        });
        return;
      }
      videoUrl = firstVideo.url;
    }

    const info = await ytdl.getBasicInfo(videoUrl, { agent: ytdlAgent });
    const stream = ytdl(videoUrl, {
      filter: "audioonly",
      quality: "highestaudio",
      agent: ytdlAgent,
    });
    const demuxer = new prism.opus.WebmDemuxer();
    stream.pipe(demuxer);

    state.currentProcess = { stream, demuxer };

    // YENİ: hata dinleyicileri ekliyoruz — önceden bu yoktu, akışta
    // bir sorun olduğunda sessizce hiçbir şey olmuyor gibi görünüyordu.
    stream.on("error", (err) => {
      console.error(`[bot/${channel}] YouTube akışı hatası:`, err.message);
    });
    demuxer.on("error", (err) => {
      console.error(`[bot/${channel}] ses ayrıştırma hatası:`, err.message);
    });

    demuxer.on("data", (opusPacket) => {
      state.peerConnections.forEach(({ sender }) => {
        try {
          sender.sendRtp(opusPacket);
        } catch (err) {
          // Bir bağlantıda anlık bir sorun olsa bile diğerlerini etkilemesin.
        }
      });
    });

    demuxer.on("end", () => {
      state.currentProcess = null;
    });

    io.to(textRoomName(channel)).emit("new-message", {
      username: BOT_NAME,
      text: `▶️ Şimdi çalıyor: ${info.videoDetails.title}`,
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
    try {
      state.currentProcess.stream.destroy();
      state.currentProcess.demuxer.destroy();
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
  // bir bot komutuydu demektir (çağıran taraf normal mesaj olarak da
  // kaydedebilir, komut olduğunu bilerek). ----
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
      console.error(`[bot/${channel}] komut işlenirken hata:`, err.message);
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
