// Teşhis kayıtları (varsayılan kapalı).

// Teşhis kayıtları (WebRTC, ICE, ses ölçümleri) sesteyken konsolu her 2,5
// saniyede dolduruyordu, artık varsayılan olarak kapalı. "npm run dev" ile
// geliştirirken açık. Paketlenmiş uygulamada açmak için: Ctrl+Shift+I ile
// konsolu aç, localStorage.setItem('discoDebug', '1') yaz, uygulamayı
// yeniden başlat (kapatmak için removeItem). Hatalar (console.error) her
// zaman görünür.
export const DEBUG = import.meta.env.DEV || window.localStorage?.getItem('discoDebug') === '1'

export function debugLog(...args) {
  if (DEBUG) console.log(...args)
}
