// Web/PWA sürümünün güncellenmesi. Uygulama kabuğu (HTML/CSS/JS) service
// worker'ın önbelleğinden açılıyor; Render'a yeni sürüm gelince yeni
// service worker arka planda iniyor ve hemen devreye giriyor, ama ekrandaki
// sayfa yenilenene kadar eski sürüm kalıyordu. Telefonda uygulama çoğu
// zaman kapanmayıp arka planda beklediği için bu günlerce sürebiliyordu.
//
// Şimdi: uygulamaya her dönüldüğünde ve saatte bir yeni sürüm aranıyor;
// yeni sürüm devreye girince onReady çağrılıyor, sayfayı ne zaman
// yenileyeceğine uygulama karar veriyor (seste kimseyi koparmasın diye).
// Masaüstü uygulaması (Electron) kendi güncelleyicisini kullanıyor.
import { registerSW } from 'virtual:pwa-register'

const CHECK_EVERY_MS = 60 * 60 * 1000

let started = false

export function startWebUpdates(onReady) {
  if (started || window.electronAPI || !/^https?:$/.test(window.location.protocol)) return
  started = true
  registerSW({
    immediate: true,
    onNeedReload: onReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {})
      }
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}
