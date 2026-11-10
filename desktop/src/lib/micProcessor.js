// Karşıya giden mikrofon sesi: ham mikrofon izi -> (güçlü gürültü bastırma
// açıksa RNNoise) -> ses kapısı (bkz. voice-gate.worklet.js) -> gönderilen iz. Mikrofon cihazı ya da ses işleme
// ayarı değişince sadece giriş değişiyor; gönderilen iz aynı kaldığı için
// bağlantılara yeniden takılması gerekmiyor.
import gateModuleUrl from './voice-gate.worklet.js?url'

const gateModules = new WeakMap() // AudioContext -> addModule sözü

export const DEFAULT_VOICE_SETTINGS = {
  noiseSuppression: true,
  // RNNoise: klavye, fan, köpek havlaması gibi konuşma olmayan sesleri
  // yapay sinir ağıyla ayıklıyor (tarayıcınınkinden çok daha güçlü).
  strongNoiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  autoSensitivity: true,
  thresholdDb: -50,
  // Seste başkalarının çaldığı ses efektlerini duy (bkz. lib/soundboard.js).
  playSoundboard: true,
}

// Seçili cihaz ve tarayıcının ses işlemesi (gürültü bastırma, yankı
// engelleme, otomatik ses seviyesi) için getUserMedia kısıtları.
export function micConstraints(deviceId, settings) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
  }
}

// Kapının ayarı: bas-konuşta hep açık, yoksa otomatik ya da elle seçilen eşik.
export function gateSettings(settings, pushToTalk) {
  if (pushToTalk) return { mode: 'off' }
  return settings.autoSensitivity ? { mode: 'auto' } : { mode: 'manual', thresholdDb: settings.thresholdDb }
}

// RNNoise WASM'ı ve worklet'i ayrı bir parçada; sadece ilk açılışta
// yükleniyor. WASM, fetch'e gerek kalmasın diye (masaüstü uygulaması dosyadan
// açılıyor) paketin içinde base64 olarak duruyor (bkz. vite.config.js).
// 48 kHz bekliyor.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
let rnnoiseAssets = null
function loadRnnoise() {
  rnnoiseAssets ??= (async () => {
    const simd = WebAssembly.validate(SIMD_PROBE)
    const [lib, worklet, wasm] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
      simd
        ? import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?base64')
        : import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?base64'),
    ])
    const bytes = Uint8Array.from(atob(wasm.default), (c) => c.charCodeAt(0))
    return { RnnoiseWorkletNode: lib.RnnoiseWorkletNode, workletUrl: worklet.default, wasmBinary: bytes.buffer }
  })()
  rnnoiseAssets.catch(() => {
    rnnoiseAssets = null
  })
  return rnnoiseAssets
}

const rnnoiseModules = new WeakMap() // AudioContext -> addModule sözü

async function createDenoiser(ctx) {
  if (ctx.sampleRate !== 48000) throw new Error(`RNNoise 48 kHz istiyor (ses motoru ${ctx.sampleRate} Hz)`)
  const { RnnoiseWorkletNode, workletUrl, wasmBinary } = await loadRnnoise()
  if (!rnnoiseModules.has(ctx)) rnnoiseModules.set(ctx, ctx.audioWorklet.addModule(workletUrl))
  await rnnoiseModules.get(ctx)
  return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmBinary.slice(0) })
}

export async function createMicProcessor(ctx, gate, { denoise = false } = {}) {
  if (!gateModules.has(ctx)) gateModules.set(ctx, ctx.audioWorklet.addModule(gateModuleUrl))
  await gateModules.get(ctx)
  const node = new AudioWorkletNode(ctx, 'ses-kapisi', {
    channelCount: 1,
    channelCountMode: 'explicit',
    outputChannelCount: [1],
    processorOptions: gate,
  })
  const destination = ctx.createMediaStreamDestination()
  destination.channelCount = 1
  node.connect(destination)
  const track = destination.stream.getAudioTracks()[0]

  const listeners = new Set()
  node.port.onmessage = ({ data }) => listeners.forEach((listener) => listener(data))

  let input = null // { track, source }
  let denoiser = null // RnnoiseWorkletNode (bir kez kuruluyor)
  let denoiseWanted = false
  let denoiseActive = false

  // Giriş: kaynak -> (RNNoise) -> kapı. Ayar değişince sadece bu bağlantı
  // değişiyor.
  const wire = () => {
    if (!input) return
    input.source.disconnect()
    denoiser?.disconnect()
    if (denoiseActive && denoiser) {
      input.source.connect(denoiser)
      denoiser.connect(node)
    } else {
      input.source.connect(node)
    }
  }

  const setDenoise = async (enabled) => {
    denoiseWanted = enabled
    if (enabled && !denoiser) {
      try {
        denoiser = await createDenoiser(ctx)
      } catch (err) {
        console.warn('[mikrofon] güçlü gürültü bastırma açılamadı:', err.message)
        denoiseActive = false
        return false
      }
    }
    denoiseActive = denoiseWanted && !!denoiser
    wire()
    return denoiseActive
  }

  const stopInput = () => {
    if (!input) return
    input.source.disconnect()
    input.track.stop()
    input = null
  }

  if (denoise) await setDenoise(true)

  return {
    track,
    // Yeni ham mikrofon izi; varsa eskisi kapatılıyor.
    setInput(rawTrack) {
      stopInput()
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]))
      input = { track: rawTrack, source }
      wire()
    },
    // Güçlü gürültü bastırmayı aç/kapat; gerçekten açıldıysa true döner
    // (WASM yüklenemezse ya da ses motoru 48 kHz değilse false).
    setDenoise,
    get denoising() {
      return denoiseActive
    },
    stopInput,
    get inputTrack() {
      return input?.track ?? null
    },
    setGate(next) {
      node.port.postMessage(next)
    },
    // Saniyede 20 kez { levelDb, thresholdDb, open }; dinlemeyi bırakan
    // fonksiyon döndürüyor.
    onLevel(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      stopInput()
      listeners.clear()
      denoiser?.destroy()
      denoiser?.disconnect()
      node.port.postMessage({ stop: true })
      node.disconnect()
      track.stop()
    },
  }
}
