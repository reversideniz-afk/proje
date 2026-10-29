// Ekran paylaşımı kalitesi: çözünürlük, kare hızı ve içerik türü. Görüntü
// sesteki herkese ayrı ayrı gönderiliyor (her eşle ayrı bağlantı), bu
// yüzden bit hızı izleyici sayısıyla çarpılıp yükleme hızından yiyor.

export const DEFAULT_SCREEN_QUALITY = { resolution: '720', frameRate: 30, content: 'motion' }

export const RESOLUTIONS = [
  { id: '720', label: '720p', width: 1280, height: 720 },
  { id: '1080', label: '1080p', width: 1920, height: 1080 },
  { id: 'source', label: 'Kaynak' },
]
export const FRAME_RATES = [15, 30, 60]
// motion: oyun ve video, akıcılık öncelikli (ağ yetmezse çözünürlük düşer);
// detail: yazı ve kod, netlik öncelikli (ağ yetmezse kare hızı düşer).
export const CONTENT_TYPES = [
  { id: 'motion', label: 'Oyun, video', hint: 'Akıcılık öncelikli' },
  { id: 'detail', label: 'Yazı, kod', hint: 'Netlik öncelikli' },
]

// Kişi başı en yüksek bit hızı (bit/sn).
const BITRATES = {
  720: { 15: 1_500_000, 30: 2_500_000, 60: 4_000_000 },
  1080: { 15: 2_500_000, 30: 4_500_000, 60: 6_500_000 },
  source: { 15: 4_000_000, 30: 6_000_000, 60: 9_000_000 },
}

export function screenBitrate(quality) {
  return BITRATES[quality.resolution]?.[quality.frameRate] ?? BITRATES[720][30]
}

export function screenTrackConstraints(quality) {
  const size = RESOLUTIONS.find((r) => r.id === quality.resolution)
  return {
    ...(size?.width ? { width: { max: size.width }, height: { max: size.height } } : {}),
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  }
}

// Yakalanan görüntüye uygulanıyor. Kaynak bu ayarları desteklemiyorsa
// (ör. tarayıcının sınırı) paylaşım olduğu gibi sürüyor.
export async function applyScreenQuality(track, quality) {
  track.contentHint = quality.content === 'detail' ? 'detail' : 'motion'
  try {
    await track.applyConstraints(screenTrackConstraints(quality))
  } catch (err) {
    console.warn('[ekran paylaşımı] kalite uygulanamadı:', err.name, err.message)
  }
}

// Bir bağlantının ekran görüntüsü kanalına bit hızı ve kare hızı sınırı.
export async function applyScreenEncoding(sender, quality) {
  const params = sender.getParameters()
  if (!params.encodings?.length) return
  params.encodings[0].maxBitrate = screenBitrate(quality)
  params.encodings[0].maxFramerate = quality.frameRate
  try {
    await sender.setParameters(params)
  } catch (err) {
    console.warn('[ekran paylaşımı] bit hızı ayarlanamadı:', err.name, err.message)
  }
}

// "4,5 Mbit/sn"
export function formatBitrate(bps) {
  return `${(bps / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mbit/sn`
}
