// Efekt sesleri (mesaj, katılma, ayrılma, bahsetme, ekran paylaşımı); hepsi
// tek, paylaşılan bir ses motorundan çalıyor.

// YENİ: Birisi @kullanıcıadı ile bahsedildiğinde çalınan kısa, nazik
// bir "ping" sesi — dışarıdan bir ses dosyası eklemeye gerek kalmasın
// diye programatik olarak (Web Audio API ile) üretiliyor.
// YENİ: Tüm ses efektlerinin ortak temeli — dışarıdan ses dosyası
// eklemeden (Web Audio API ile üreterek), belirli bir frekans/süre/
// dalga tipinde kısa bir ton çalar.
function playTone(ctx, frequency, startOffset, duration, gainValue = 0.12, type = 'sine') {
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.value = frequency
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)
  const startTime = ctx.currentTime + startOffset
  gainNode.gain.setValueAtTime(gainValue, startTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  oscillator.start(startTime)
  oscillator.stop(startTime + duration)
}

// Bütün efekt sesleri TEK bir ses motorunu (AudioContext) paylaşıyor.
// Eskiden her ses yeni bir motor açıyor ve hiç kapatmıyordu; uzun bir
// akşamda yüzlercesi birikiyordu (H10). Efektler de ayarlarda seçilen
// çıkış cihazına gidiyor (bkz. setEffectsOutputDevice).
let effectsContext = null

let effectsOutputDeviceId = ''

export function setEffectsOutputDevice(deviceId) {
  effectsOutputDeviceId = deviceId || ''
  if (effectsContext && typeof effectsContext.setSinkId === 'function') {
    effectsContext.setSinkId(effectsOutputDeviceId).catch(() => {
      // Cihaz seçilemezse efektler varsayılan çıkıştan çalmaya devam eder.
    })
  }
}

function withAudioContext(fn) {
  try {
    if (!effectsContext || effectsContext.state === 'closed') {
      effectsContext = new (window.AudioContext || window.webkitAudioContext)()
      if (effectsOutputDeviceId) setEffectsOutputDevice(effectsOutputDeviceId)
    }
    if (effectsContext.state === 'suspended') effectsContext.resume()
    fn(effectsContext)
  } catch {
    // Ses opsiyonel bir özellik — başarısız olursa sessizce geç.
  }
}

// Birisi @kullanıcıadımla bahsettiğinde.
export function playMentionSound() {
  withAudioContext((ctx) => playTone(ctx, 880, 0, 0.3, 0.15))
}

// YENİ: Biri sese katıldığında — yükselen, "hoş geldin" hissi veren iki nota.
export function playJoinSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 523.25, 0, 0.12, 0.1) // Do
    playTone(ctx, 659.25, 0.08, 0.16, 0.1) // Mi
  })
}

// YENİ: Biri sesten ayrıldığında — alçalan iki nota.
export function playLeaveSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 659.25, 0, 0.12, 0.1) // Mi
    playTone(ctx, 523.25, 0.08, 0.16, 0.1) // Do
  })
}

// YENİ: Yeni bir mesaj geldiğinde — kısa, nazik bir "tık".
export function playMessageSound() {
  withAudioContext((ctx) => playTone(ctx, 700, 0, 0.09, 0.07))
}

// YENİ: Biri (ya da sen) ekran paylaşımını başlattığında — farklı bir
// tını (üçgen dalga) ile ayırt edilebilir olsun diye.
export function playScreenShareSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 440, 0, 0.1, 0.1, 'triangle')
    playTone(ctx, 880, 0.07, 0.14, 0.1, 'triangle')
  })
}

// Ses efektleri panelinden çalınan bir efekt (bkz. lib/soundboard.js);
// diğer efektlerle aynı motordan ve çıkış cihazından.
export function playSoundEffect(sound) {
  withAudioContext((ctx) => {
    const out = ctx.createGain()
    out.gain.value = 0.9
    out.connect(ctx.destination)
    sound.play(ctx, out)
  })
}
