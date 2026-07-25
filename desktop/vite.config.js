import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron üretim modunda (paketlenmiş .exe/.dmg) dosyaları file:// ile
  // açacağız. Vite varsayılan olarak "/assets/..." gibi KÖK-göreli yollar
  // üretir, bu da file:// üzerinden çalışmaz. base:'./' ile yollar
  // "./assets/..." gibi GÖRELİ olur — böylece hem geliştirme hem üretimde
  // sorunsuz çalışır. (Bunu şimdiden ekliyoruz ki Aşama 9'da paketlerken
  // sürpriz bir hatayla karşılaşmayalım.)
  base: './',
})
