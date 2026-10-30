// Ses efektleri paneli: seste birinin çaldığı kısa efektler herkesin
// hoparlöründe çalıyor (mikrofondan gitmiyor). Hepsi Web Audio ile
// üretiliyor, ses dosyası yok. Sunucu (server/lib/soundboard.js) aynı
// kimlikleri kabul ediyor.

function envelope(ctx, node, start, peak, attack, decay) {
  node.gain.setValueAtTime(0.0001, start)
  node.gain.exponentialRampToValueAtTime(peak, start + attack)
  node.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)
}

function tone(ctx, out, { freq, type = 'sine', start = 0, peak = 0.2, attack = 0.01, decay = 0.3, endFreq }) {
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay)
  envelope(ctx, gain, t, peak, attack, decay)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + attack + decay + 0.05)
}

function noise(ctx, out, { start = 0, peak = 0.3, attack = 0.002, decay = 0.08, highpass = 1000 }) {
  const t = ctx.currentTime + start
  const length = Math.ceil((attack + decay + 0.05) * ctx.sampleRate)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = highpass
  const gain = ctx.createGain()
  envelope(ctx, gain, t, peak, attack, decay)
  source.connect(filter).connect(gain).connect(out)
  source.start(t)
}

export const SOUNDS = [
  {
    id: 'alkis',
    label: 'Alkış',
    emoji: '👏',
    play: (ctx, out) => {
      for (let i = 0; i < 26; i++) noise(ctx, out, { start: i * 0.045 + Math.random() * 0.03, peak: 0.12 + Math.random() * 0.12, decay: 0.05, highpass: 1500 })
    },
  },
  {
    id: 'davul',
    label: 'Ba dum tss',
    emoji: '🥁',
    play: (ctx, out) => {
      tone(ctx, out, { freq: 180, endFreq: 70, start: 0, peak: 0.5, decay: 0.18 })
      tone(ctx, out, { freq: 150, endFreq: 60, start: 0.18, peak: 0.5, decay: 0.2 })
      noise(ctx, out, { start: 0.4, peak: 0.25, decay: 0.9, highpass: 6000 })
    },
  },
  {
    id: 'korna',
    label: 'Korna',
    emoji: '📯',
    play: (ctx, out) => {
      for (const start of [0, 0.32]) {
        tone(ctx, out, { freq: 415, type: 'sawtooth', start, peak: 0.12, attack: 0.02, decay: 0.24 })
        tone(ctx, out, { freq: 523, type: 'sawtooth', start, peak: 0.1, attack: 0.02, decay: 0.24 })
      }
    },
  },
  {
    id: 'tada',
    label: 'Ta-da',
    emoji: '🎉',
    play: (ctx, out) => {
      tone(ctx, out, { freq: 523.25, type: 'triangle', start: 0, peak: 0.2, decay: 0.15 })
      for (const freq of [523.25, 659.25, 783.99, 1046.5]) {
        tone(ctx, out, { freq, type: 'triangle', start: 0.16, peak: 0.14, decay: 0.9 })
      }
    },
  },
  {
    id: 'uzgun',
    label: 'Olmadı',
    emoji: '🎺',
    play: (ctx, out) => {
      const notes = [392, 370, 349.23, 329.63]
      notes.forEach((freq, i) => {
        const last = i === notes.length - 1
        tone(ctx, out, { freq, type: 'sawtooth', start: i * 0.38, peak: 0.1, attack: 0.03, decay: last ? 0.9 : 0.32, endFreq: last ? 300 : undefined })
      })
    },
  },
  {
    id: 'zil',
    label: 'Zil',
    emoji: '🔔',
    play: (ctx, out) => {
      for (const [freq, peak] of [[880, 0.2], [2200, 0.08], [3520, 0.05]]) tone(ctx, out, { freq, start: 0, peak, decay: 1.4 })
    },
  },
  {
    id: 'cirp',
    label: 'Cırcır',
    emoji: '🦗',
    play: (ctx, out) => {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) tone(ctx, out, { freq: 4400, start: i * 0.5 + j * 0.035, peak: 0.06, attack: 0.004, decay: 0.025 })
      }
    },
  },
  {
    id: 'boing',
    label: 'Boing',
    emoji: '🤸',
    play: (ctx, out) => {
      tone(ctx, out, { freq: 140, endFreq: 520, start: 0, peak: 0.3, attack: 0.01, decay: 0.45 })
    },
  },
]

export function soundById(id) {
  return SOUNDS.find((sound) => sound.id === id) || null
}
