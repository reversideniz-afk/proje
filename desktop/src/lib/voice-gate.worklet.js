// Ses kapısı (AudioWorklet: ses iş parçacığında çalışıyor, pencere arkadayken
// de yavaşlamıyor). Mikrofon sesi eşiğin altındayken karşıya sessizlik
// gidiyor. Eşik ya elle seçiliyor ('manual') ya da ortam gürültüsüne göre
// kendiliğinden ayarlanıyor ('auto'); bas-konuşta kapı hep açık ('off').
//
// Ses 10 ms geciktirilerek veriliyor: kapı konuşmanın başını duyduğu anda
// açılıyor, o baş henüz çıkmamış oluyor; kelimenin ilk sesi kesilmiyor.
// Ses eşiğin altına düştükten sonra kapı 350 ms daha açık kalıyor (kelime
// araları), sonra yumuşakça kapanıyor.

const LOOKAHEAD_S = 0.01
const HOLD_S = 0.35
const ATTACK_S = 0.004
const RELEASE_S = 0.08
const LEVEL_FALL_S = 0.03 // ölçülen seviyenin düşüş süresi
const REPORT_S = 0.05 // ayarlardaki seviye çubuğu için saniyede 20 durum
// Otomatik eşik: son 2 saniyenin en sessiz anı (ortam gürültüsü) + 12 dB,
// -60 ile -36 dB arasında.
const FLOOR_BLOCK_S = 0.25
const FLOOR_BLOCKS = 8
const AUTO_MARGIN_DB = 12
const AUTO_MIN_DB = -60
const AUTO_MAX_DB = -36
const SILENCE_DB = -100

function toDb(rms) {
  return rms > 1e-5 ? 20 * Math.log10(rms) : SILENCE_DB
}

class VoiceGate extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { mode = 'auto', thresholdDb = -50 } = options.processorOptions || {}
    this.mode = mode
    this.manualDb = thresholdDb
    this.delay = new Float32Array(Math.max(1, Math.round(LOOKAHEAD_S * sampleRate)))
    this.delayPos = 0
    this.gain = 0
    this.level = 0
    this.holdLeft = 0
    this.blockMins = []
    this.blockMin = Infinity
    this.blockLeft = FLOOR_BLOCK_S
    this.reportLeft = REPORT_S
    this.reportDb = SILENCE_DB
    this.reportOpen = false
    this.running = true
    this.port.onmessage = ({ data }) => {
      if (data.stop) this.running = false
      if (data.mode) this.mode = data.mode
      if (typeof data.thresholdDb === 'number') this.manualDb = data.thresholdDb
    }
  }

  threshold() {
    if (this.mode === 'off') return null
    if (this.mode === 'manual') return this.manualDb
    const floor = Math.min(this.blockMin, ...this.blockMins)
    return Math.min(AUTO_MAX_DB, Math.max(AUTO_MIN_DB, floor + AUTO_MARGIN_DB))
  }

  process(inputs, outputs) {
    const input = inputs[0][0]
    const output = outputs[0][0]
    const frames = output.length
    const dt = frames / sampleRate

    // Seviye: bu parçanın etkin değeri; hızlı yükselip yavaş düşüyor.
    let sum = 0
    if (input) for (let i = 0; i < frames; i++) sum += input[i] * input[i]
    const rms = Math.sqrt(sum / frames)
    this.level = Math.max(rms, this.level * Math.exp(-dt / LEVEL_FALL_S))
    const levelDb = toDb(this.level)

    // Ortam gürültüsü: 250 ms'lik blokların en sessiz anları. Tam sessizlik
    // (mikrofon kapalı) ortam sayılmıyor; yoksa açınca eşik yerlerde kalırdı.
    if (rms > 0) this.blockMin = Math.min(this.blockMin, levelDb)
    this.blockLeft -= dt
    if (this.blockLeft <= 0) {
      this.blockMins.push(this.blockMin)
      if (this.blockMins.length > FLOOR_BLOCKS) this.blockMins.shift()
      this.blockMin = Infinity
      this.blockLeft += FLOOR_BLOCK_S
    }

    const thresholdDb = this.threshold()
    if (thresholdDb === null || levelDb >= thresholdDb) this.holdLeft = HOLD_S
    else this.holdLeft = Math.max(0, this.holdLeft - dt)
    const open = this.holdLeft > 0

    const step = open ? 1 / (ATTACK_S * sampleRate) : -1 / (RELEASE_S * sampleRate)
    const delay = this.delay
    for (let i = 0; i < frames; i++) {
      const delayed = delay[this.delayPos]
      delay[this.delayPos] = input ? input[i] : 0
      this.delayPos = (this.delayPos + 1) % delay.length
      this.gain = Math.min(1, Math.max(0, this.gain + step))
      output[i] = delayed * this.gain
    }

    this.reportDb = Math.max(this.reportDb, levelDb)
    this.reportOpen = this.reportOpen || open
    this.reportLeft -= dt
    if (this.reportLeft <= 0) {
      this.port.postMessage({ levelDb: this.reportDb, thresholdDb, open: this.reportOpen })
      this.reportDb = SILENCE_DB
      this.reportOpen = false
      this.reportLeft += REPORT_S
    }
    return this.running
  }
}

registerProcessor('ses-kapisi', VoiceGate)
