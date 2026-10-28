// Uygulama genelindeki sabitler: sunucu adresi, varsayılan ICE sunucuları,
// tepki kısayolları, renk temaları, masaüstü uygulamasında mı çalışıyoruz.

// Sunucu adresi vite.config.js'ten geliyor (varsayılan: Render).
export const SERVER_URL = import.meta.env.VITE_SERVER_URL

// YENİ: Mesaj tepkileri için hızlı seçim listesi.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

// YENİ: TURN bilgileri koda GÖMÜLMÜYOR — girişten sonra sunucudan geliyor.
export const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// YENİ: Renk temaları — her biri sadece App.css'teki :root[data-theme]
// bloğuyla eşleşen bir kimlik + önizleme rengi. Yeni bir tema eklemek
// istersen: App.css'e bir blok, buraya bir satır eklemen yeterli.
export const THEMES = [
  { id: 'mercan', label: 'Mercan', color: '#f2726c' },
  { id: 'mor', label: 'Mor', color: '#a374f2' },
  { id: 'mavi', label: 'Mavi', color: '#5b9bf2' },
  { id: 'yesil', label: 'Yeşil', color: '#4caf7d' },
  { id: 'amber', label: 'Amber', color: '#e0a940' },
  { id: 'pembe', label: 'Pembe', color: '#f26ca3' },
]

// Yakınlaştırma ve tam ekran sadece masaüstü uygulamasında (Electron) var;
// web/PWA'da tarayıcının kendi yakınlaştırması kullanılıyor.
export const IS_DESKTOP_APP = !!window.electronAPI?.setZoomFactor
