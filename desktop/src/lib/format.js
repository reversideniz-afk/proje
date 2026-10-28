// Görüntülemek için biçimlendirme: tuş adları, mesaj saati ve günü, medya hataları.

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
