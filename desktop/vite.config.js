import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // YENİ: Web/PWA sürümü için — "ana ekrana ekle" ve temel çevrimdışı
    // önbellekleme desteği. NOT: Electron paketlemesini ETKİLEMİYOR —
    // registerType:'autoUpdate' ile eklenen kayıt kodu zaten
    // "serviceWorker" var mı diye kontrol ediyor, file:// üzerinden
    // (Electron) çalışırken servis çalışanı kaydı sessizce atlanıyor.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Disco',
        short_name: 'Disco',
        description: 'Arkadaş grubu için sesli/görüntülü sohbet uygulaması',
        theme_color: '#1c1a19',
        background_color: '#1c1a19',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // YENİ: sesli/görüntülü sohbet WebSocket + WebRTC üzerinden CANLI
      // veri taşıyor — bunu önbelleğe almaya kalkışmak anlamsız/zararlı
      // olurdu. Service worker sadece UYGULAMA KABUĞUNU (HTML/CSS/JS)
      // önbelleğe alıp "ana ekrana ekle" kriterini karşılıyor.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallbackDenylist: [/^\/socket\.io\//],
      },
    }),
  ],
  // Electron üretim modunda (paketlenmiş .exe/.dmg) dosyaları file:// ile
  // açacağız. Vite varsayılan olarak "/assets/..." gibi KÖK-göreli yollar
  // üretir, bu da file:// üzerinden çalışmaz. base:'./' ile yollar
  // "./assets/..." gibi GÖRELİ olur — böylece hem geliştirme hem üretimde
  // sorunsuz çalışır. (Bunu şimdiden ekliyoruz ki Aşama 9'da paketlerken
  // sürpriz bir hatayla karşılaşmayalım.)
  base: './',
})
