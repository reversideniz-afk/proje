// Kim konuşuyor: seste her ses kaynağının (karşı taraflar ve kendi
// mikrofonun) seviyesini saniyede 10 kez ölçüp eşiği geçenleri döndürüyor.
// Kelime aralarında ışık yanıp sönmesin diye ses kesildikten sonra 400 ms
// daha "konuşuyor" sayılıyor.
import { useEffect, useState } from 'react'

const SPEAKING_RMS = 0.012
const HOLD_MS = 400
const INTERVAL_MS = 100

function sameSet(a, b) {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

export function rmsOf(analyser, buffers) {
  let data = buffers.get(analyser)
  if (!data || data.length !== analyser.fftSize) {
    data = new Float32Array(analyser.fftSize)
    buffers.set(analyser, data)
  }
  analyser.getFloatTimeDomainData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

// getSources: [kimlik, AnalyserNode] çiftleri döndüren fonksiyon. Kaynaklar
// ses boyunca değişiyor (biri girip çıkıyor, mikrofon açılıyor), bu yüzden
// her ölçümde yeniden soruluyor.
export function useSpeakingDetector(getSources, enabled) {
  const [speaking, setSpeaking] = useState(() => new Set())

  useEffect(() => {
    if (!enabled) {
      setSpeaking((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    const lastLoudAt = new Map()
    const buffers = new WeakMap()
    const timer = setInterval(() => {
      const now = performance.now()
      const next = new Set()
      for (const [id, analyser] of getSources()) {
        if (rmsOf(analyser, buffers) > SPEAKING_RMS) lastLoudAt.set(id, now)
        if (now - (lastLoudAt.get(id) ?? -Infinity) < HOLD_MS) next.add(id)
      }
      setSpeaking((prev) => (sameSet(prev, next) ? prev : next))
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [enabled, getSources])

  return speaking
}
