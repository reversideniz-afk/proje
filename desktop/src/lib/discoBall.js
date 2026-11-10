// Ayna top: her ses kanalının topu kendi renginden üretiliyor. Renk kanal
// ayarından (#RRGGBB) seçilebiliyor; seçilmemişse kanal adından sabit bir
// renk çıkıyor (aynı ad hep aynı topu verir).

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [h, s * 100, l * 100]
}

export function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
      .toString(16)
      .padStart(2, '0')
  return ('#' + f(0) + f(8) + f(4)).toUpperCase()
}

const clamp = (v) => Math.round(Math.max(0, Math.min(100, v)))
const hsl = (h, s, l) => `hsl(${Math.round((h + 360) % 360)} ${clamp(s)}% ${clamp(l)}%)`

// Kanal adından renk: ad aynı kaldıkça değişmiyor.
export function autoBallColor(name = '') {
  let sum = 0
  for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) % 360
  return hslToHex(sum, 75, 60)
}

export function randomBallColor() {
  return hslToHex(Math.floor(Math.random() * 360), 65 + Math.floor(Math.random() * 25), 55 + Math.floor(Math.random() * 10))
}

export function ballColorOf(channel) {
  if (channel?.ballColor && HEX_COLOR.test(channel.ballColor)) return channel.ballColor.toUpperCase()
  return autoBallColor(channel?.name || '')
}

// Seçilen renge yakın altı ton: açık, orta, koyu ve biraz kaymış tonlar.
export function ballTones(hex) {
  const [h, s] = hexToHsl(hex)
  return [hsl(h, s * 0.3, 94), hsl(h, s * 0.55, 80), hsl(h + 8, s * 0.8, 66), hsl(h, s, 54), hsl(h - 10, s * 0.9, 40), hsl(h + 20, s * 0.6, 72)]
}

// Rengi tonda kaydırıp (ve istenirse açıp) yeni bir hex.
export function shiftHue(hex, degrees, lighten = 0) {
  const [h, s, l] = hexToHsl(hex)
  return hslToHex((h + degrees + 360) % 360, s, Math.min(92, l + lighten))
}

export function ballGlow(hex, alpha = 0.45) {
  const [h] = hexToHsl(hex)
  return `hsl(${Math.round(h)} 90% 60% / ${alpha})`
}

// Topun yüzeyi: n satır, 2n sütun ayna parçası (iki tur yan yana, sonsuz
// kayabilsin diye). Tek bir SVG resmi; top bunu yatayda kaydırıyor.
const stripCache = new Map()
export function ballStripUrl(hex, n = 10, glintEvery = 13) {
  const key = `${hex}|${n}|${glintEvery}`
  const cached = stripCache.get(key)
  if (cached) return cached
  const tones = ballTones(hex)
  const cell = 10
  const cols = n * 2
  let rects = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < cols; c++) {
      const cc = c % n
      const glint = glintEvery && (r * 5 + cc * 11) % glintEvery === 0
      rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${glint ? '#fff' : tones[(r * 7 + cc * 3) % tones.length]}"/>`
    }
  }
  let grid = ''
  for (let c = 1; c <= cols; c++) grid += `M${c * cell - 0.6} 0V${n * cell}`
  for (let r = 1; r <= n; r++) grid += `M0 ${r * cell - 0.6}H${cols * cell}`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cell} ${n * cell}" preserveAspectRatio="none">` +
    rects +
    `<path d="${grid}" stroke="rgba(0,0,0,0.22)" stroke-width="1.2" fill="none"/></svg>`
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  stripCache.set(key, url)
  return url
}
