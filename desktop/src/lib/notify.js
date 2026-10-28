// Masaüstü bildirimleri ve görev çubuğundaki işaret (bahsedilme sayısı).
import logoUrl from '../assets/logo.png'

export function notificationsSupported() {
  return 'Notification' in window
}

// İzin isteniyor (tarayıcıda bir kez soruluyor, masaüstünde uygulama
// kendisi onaylıyor). İzin varsa true.
export async function ensureNotificationPermission() {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

// Ses ayrıca (uygulamanın kendi sesiyle) çalınıyor, bildirim sessiz. Aynı
// kanaldan gelen yeni bildirim eskisinin yerini alıyor (tag).
export function showNotification({ title, body, tag, onClick }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const notification = new Notification(title, { body, tag, icon: logoUrl, silent: true })
  notification.onclick = () => {
    window.electronAPI?.showWindow?.()
    window.focus()
    onClick?.()
    notification.close()
  }
}

// Görev çubuğu simgesinin köşesindeki kırmızı sayı (masaüstü) ya da
// uygulama rozeti (ana ekrana eklenmiş web sürümü).
function drawBadge(count) {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e5484d'
  ctx.beginPath()
  ctx.arc(16, 16, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${count > 9 ? 15 : 20}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), 16, 17)
  return canvas.toDataURL('image/png')
}

export function setAttentionBadge(count) {
  if (window.electronAPI?.setBadge) {
    window.electronAPI.setBadge(count, count > 0 ? drawBadge(count) : null)
    return
  }
  if (count > 0) navigator.setAppBadge?.(count)?.catch(() => {})
  else navigator.clearAppBadge?.()?.catch(() => {})
}

// Masaüstünde pencere öne gelene kadar görev çubuğunda yanıp sönüyor.
export function requestAttention() {
  window.electronAPI?.flashFrame?.()
}
