// Karşıya giden mikrofon sesi: ham mikrofon izi -> ses kapısı (bkz.
// voice-gate.worklet.js) -> gönderilen iz. Mikrofon cihazı ya da ses işleme
// ayarı değişince sadece giriş değişiyor; gönderilen iz aynı kaldığı için
// bağlantılara yeniden takılması gerekmiyor.
import gateModuleUrl from './voice-gate.worklet.js?url'

const gateModules = new WeakMap() // AudioContext -> addModule sözü

export const DEFAULT_VOICE_SETTINGS = {
  noiseSuppression: true,
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

export async function createMicProcessor(ctx, gate) {
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
  const stopInput = () => {
    if (!input) return
    input.source.disconnect()
    input.track.stop()
    input = null
  }

  return {
    track,
    // Yeni ham mikrofon izi; varsa eskisi kapatılıyor.
    setInput(rawTrack) {
      stopInput()
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]))
      source.connect(node)
      input = { track: rawTrack, source }
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
      node.port.postMessage({ stop: true })
      node.disconnect()
      track.stop()
    },
  }
}
