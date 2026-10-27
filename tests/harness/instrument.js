// Her test sayfasına, uygulama kodundan ÖNCE enjekte edilen gözlem kodu.
// Uygulamayı değiştirmiyor; sadece oluşturulan WebRTC bağlantılarını, ses
// motorlarını (AudioContext), çalınan efekt tonlarını, mikrofon/kamera
// izlerini ve hoparlöre giden sesi window.__disco altında kayda geçiriyor
// ki testler ölçebilsin.
export function instrumentPage() {
  const disco = (window.__disco = {
    pcs: [],
    audioContexts: [],
    tones: [],
    mediaTracks: [],
    speakerTaps: [],
  })

  // Hoparlöre (ctx.destination) bağlanan her düğümü ayrıca bir ölçere de
  // bağlıyoruz: kullanıcının gerçekten ne duyacağını buradan okuyoruz.
  const nativeConnect = AudioNode.prototype.connect
  const tapByContext = new Map()
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = nativeConnect.call(this, target, ...rest)
    if (target instanceof AudioDestinationNode) {
      let tap = tapByContext.get(target.context)
      if (!tap) {
        tap = target.context.createAnalyser()
        tap.fftSize = 2048
        tapByContext.set(target.context, tap)
        disco.speakerTaps.push(tap)
      }
      nativeConnect.call(this, tap)
    }
    return result
  }

  const NativePeerConnection = window.RTCPeerConnection
  window.RTCPeerConnection = class extends NativePeerConnection {
    constructor(...args) {
      super(...args)
      disco.pcs.push(this)
    }
  }

  const NativeAudioContext = window.AudioContext
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args)
      disco.audioContexts.push(this)
    }
  }

  const nativeStart = OscillatorNode.prototype.start
  OscillatorNode.prototype.start = function (...args) {
    disco.tones.push(this.frequency.value)
    return nativeStart.apply(this, args)
  }

  const nativeGetUserMedia = MediaDevices.prototype.getUserMedia
  MediaDevices.prototype.getUserMedia = async function (...args) {
    const stream = await nativeGetUserMedia.apply(this, args)
    disco.mediaTracks.push(...stream.getTracks())
    return stream
  }
}

// Sayfada çalışır: açık WebRTC bağlantıları üzerinden GELEN ses paketleri.
export async function readIncomingAudioBytes() {
  let bytes = 0
  for (const pc of window.__disco.pcs) {
    if (pc.connectionState === 'closed') continue
    const stats = await pc.getStats()
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') bytes += report.bytesReceived || 0
    })
  }
  return bytes
}

// Sayfada çalışır: ~1 saniye boyunca hoparlöre giden sesin en yüksek
// genliği (0 = tam sessizlik, 1 = en yüksek).
export async function readSpeakerPeak() {
  const taps = window.__disco.speakerTaps
  const buffer = new Float32Array(2048)
  let peak = 0
  for (let i = 0; i < 20; i++) {
    for (const tap of taps) {
      tap.getFloatTimeDomainData(buffer)
      for (const v of buffer) peak = Math.max(peak, Math.abs(v))
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return peak
}
