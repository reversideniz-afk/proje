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
    webSockets: [],
  })

  const NativeWebSocket = window.WebSocket
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {
      super(...args)
      disco.webSockets.push(String(args[0]))
    }
  }

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

  // Kamera: Chromium'un sahte kamera aygıtı başsız Edge'de zaman zaman hiç
  // kare üretmiyor ya da kendiliğinden kapanıyor. Testler kararsız olmasın
  // diye görüntüyü hareketli bir tuvalden üretiyoruz; mikrofon yine
  // tarayıcının sahte (bip sesli) aygıtından geliyor.
  function canvasCameraTrack() {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')
    let frame = 0
    const draw = () => {
      ctx.fillStyle = `hsl(${(frame * 7) % 360} 55% 40%)`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#fff'
      ctx.font = '64px sans-serif'
      ctx.fillText(`test kamerası ${frame++}`, 32, 96)
    }
    draw()
    const timer = setInterval(draw, 66)
    const track = canvas.captureStream(15).getVideoTracks()[0]
    const nativeStop = track.stop.bind(track)
    track.stop = () => {
      clearInterval(timer)
      nativeStop()
    }
    return track
  }

  // Ekran paylaşımı: başsız tarayıcıda seçilecek bir ekran yok, aynı
  // tuval kaynağını "ekran" olarak veriyoruz.
  MediaDevices.prototype.getDisplayMedia = async function () {
    const track = canvasCameraTrack()
    disco.mediaTracks.push(track)
    return new MediaStream([track])
  }

  const nativeGetUserMedia = MediaDevices.prototype.getUserMedia
  MediaDevices.prototype.getUserMedia = async function (constraints = {}) {
    const audioTracks = constraints.audio
      ? (await nativeGetUserMedia.call(this, { audio: constraints.audio })).getTracks()
      : []
    const tracks = [...audioTracks, ...(constraints.video ? [canvasCameraTrack()] : [])]
    disco.mediaTracks.push(...tracks)
    return new MediaStream(tracks)
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

// Sayfada çalışır: açık her bağlantı için ayrı ayrı gelen ses paketleri.
export async function readIncomingAudioBytesPerConnection() {
  const result = []
  for (const pc of window.__disco.pcs) {
    if (pc.connectionState === 'closed') continue
    let bytes = 0
    const stats = await pc.getStats()
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') bytes += report.bytesReceived || 0
    })
    result.push(bytes)
  }
  return result
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
