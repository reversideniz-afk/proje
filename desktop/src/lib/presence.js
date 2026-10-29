// Durum ve etkinlik: seçilebilen durumlar, özel durumun süresi, kendiliğinden
// "boşta" sayılma. Sunucu (server/lib/presence.js) aynı durumları doğruluyor.

export const STATUSES = [
  { id: 'online', label: 'Çevrimiçi' },
  { id: 'idle', label: 'Boşta', hint: 'Bir süre uzakta olduğunu gösterir.' },
  { id: 'dnd', label: 'Rahatsız etmeyin', hint: 'Masaüstü bildirimleri ve mesaj sesleri kapanır.' },
  { id: 'invisible', label: 'Görünmez', hint: 'Diğerlerine çevrimdışı görünürsün, her şeyi kullanmaya devam edersin.' },
]

export const CUSTOM_STATUS_DURATIONS = [
  { hours: 1, label: '1 saat' },
  { hours: 4, label: '4 saat' },
  { hours: 24, label: '1 gün' },
  { hours: null, label: 'Ben silene kadar' },
]

// Bu kadar süre klavye ve fare kullanılmazsa "boşta" (Çevrimiçi seçiliyken).
// Teşhis ve testler için localStorage 'discoIdleAfterMs' ile kısaltılabiliyor.
export const IDLE_AFTER_MS = (() => {
  try {
    return Number(window.localStorage?.getItem('discoIdleAfterMs')) || 10 * 60 * 1000
  } catch {
    return 10 * 60 * 1000
  }
})()

export function statusLabel(status) {
  if (status === 'offline') return 'Çevrimdışı'
  return STATUSES.find((s) => s.id === status)?.label ?? 'Çevrimiçi'
}
