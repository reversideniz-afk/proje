// Görüntülemek için biçimlendirme: tuş adları, mesaj saati ve günü, medya hataları,
// sunucu simgesindeki harfler.

// Etkinlik zamanı: "Cumartesi 2 Kasım 21:00".
export function formatEventTime(date) {
  return new Date(date).toLocaleString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Şimdiye göre: "yarın", "3 gün sonra", "2 saat sonra", "10 dakika önce".
export function formatRelative(date, now = new Date()) {
  const diff = new Date(date).getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(diff / 3_600_000)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(diff / 86_400_000), 'day')
}

// Bir ada yönelme eki: "Ece" -> "Ece'ye", "Mert" -> "Mert'e", "Bora" ->
// "Bora'ya" (son ünlüye göre e/a, ünlüyle bitiyorsa araya y).
export function toDative(name) {
  const vowels = name.toLocaleLowerCase('tr').match(/[aeıioöuü]/g)
  const front = !vowels || 'eiöü'.includes(vowels.at(-1))
  const buffer = /[aeıioöuü]$/i.test(name) ? 'y' : ''
  return `${name}'${buffer}${front ? 'e' : 'a'}`
}

// Sunucu simgesindeki harfler: "Oyun Gecesi" -> "OG", "Disco" -> "DI".
export function serverInitials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2)
  return letters.toLocaleUpperCase('tr')
}

// YENİ: bas-konuş için seçilen tuşu (event.code) okunabilir göstermek için.
export function formatKeyCode(code) {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Boşluk'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt'
  if (code === 'Mouse4' || code === 'Mouse5') return 'Fare ' + code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  return code
}

// Kısa bitiş zamanı: bugünse "12:05", değilse "3 Kas 12:05".
export function formatShortDateTime(date, now = new Date()) {
  const d = new Date(date)
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  if (isSameDay(d, now)) return time
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${time}`
}

// YENİ: Mesaj saatini okunabilir göstermek için.
export function formatMessageTime(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function isSameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  )
}

// Sohbetteki gün ayracı: "Bugün", "Dün", "25 Ekim Cumartesi"; başka bir
// yıldansa yıl da yazılıyor.
export function formatDayLabel(dateStr, now = new Date()) {
  const date = new Date(dateStr)
  if (isSameDay(date, now)) return 'Bugün'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Dün'
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? { weekday: 'long' } : { year: 'numeric' }),
  })
}

// Mesajın tam tarihi (saatin üstüne gelince görünen ipucu).
export function formatFullDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export function describeMediaError(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Kamera/mikrofon izni reddedildi. Windows Ayarları > Gizlilik ve güvenlik > Kamera / Mikrofon bölümünden masaüstü uygulamalarına izin verildiğinden emin ol.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera veya mikrofon bulunamadı.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kamera veya mikrofon başka bir uygulama tarafından kullanılıyor olabilir.'
    default:
      return `Medya erişiminde beklenmeyen bir hata oldu: ${err.message}`
  }
}
