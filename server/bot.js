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

const OPUS_CODEC = new RTCRtpCodecParameters({
  mimeType: "audio/opus",
  clockRate: 48000,
  channels: 2,
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
      codecs: { audio: [OPUS_CODEC] },
    });

    const track = new MediaStreamTrack({ kind: "audio" });
    // Gerçek kullanıcıların bağlantısı hem ses hem görüntü yuvası
    // açıyor (recvonly) — botun cevabı bu iki yuvaya da denk düşen
    // bir yapıda olmalı, yoksa SDP uyumsuzluğu olur (bu projede daha
    // önce tam bu tür bir hatayla karşılaşmıştık). Bot'un görüntüsü
    // yok, o yüzden video'yu "inactive" bırakıyoruz.
    pc.addTransceiver(track, { direction: "sendonly" });
    pc.addTransceiver("video", { direction: "inactive" });

    pc.onicecandidate = (candidate) => {
      if (candidate) {
        io.to(realSocketId).emit("signal", {
          from: botSocketId(channel),
          data: { type: "ice-candidate", candidate, connectionType: "main" },
        });
      }
    };

    state.peerConnections.set(realSocketId, { pc, track });

    // Bu ana kadar bir şarkı zaten çalıyorsa, yeni bağlanan kişi de
    // duysun diye aynı track'i bağlıyoruz (writeRtp zaten state.audioTrack
    // üzerinden merkezi olarak besleniyor, bkz. playSong).
    return { pc, track };
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

    const info = await ytdl.getBasicInfo(videoUrl);
    const stream = ytdl(videoUrl, { filter: "audioonly", quality: "highestaudio" });
    const demuxer = new prism.opus.WebmDemuxer();
    stream.pipe(demuxer);

    state.currentProcess = { stream, demuxer };

    demuxer.on("data", (opusPacket) => {
      state.peerConnections.forEach(({ track }) => {
        try {
          track.writeRtp(opusPacket);
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

  function stopSong(channel) {
    const state = channelState.get(channel);
    if (!state?.currentProcess) return;
    try {
      state.currentProcess.stream.destroy();
      state.currentProcess.demuxer.destroy();
    } catch {
      /* zaten kapanmış olabilir */
    }
    state.currentProcess = null;
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
        stopSong(channel);
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
