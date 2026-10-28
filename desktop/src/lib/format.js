// Görüntülemek için biçimlendirme: tuş adları, mesaj saati, medya hataları.

// YENİ: bas-konuş için seçilen tuşu (event.code) okunabilir göstermek için.
export function formatKeyCode(code) {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Boşluk'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt'
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
