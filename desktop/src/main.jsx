import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Yazı tipleri uygulamanın içine gömülü (internet olmadan da çalışıyor,
// güvenlik politikası dışarıdan bir şey yüklemeye izin vermiyor).
import '@fontsource-variable/unbounded/wght.css'
import '@fontsource-variable/onest/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './styles/base.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
