// ============================================================
// PRELOAD BETİĞİ
// ------------------------------------------------------------
// Bu dosya, React tarafı (renderer) yüklenmeden HEMEN ÖNCE çalışır
// ve main process ile renderer arasında GÜVENLİ bir köprü kurmak
// için kullanılır — contextBridge.exposeInMainWorld() ile.
//
// YENİ: Artık gerçekten kullanıyoruz — ekran paylaşımı seçim
// arayüzü için main.cjs ile React arasında iki yönlü iletişim
// gerekiyor:
//   - onScreenSources: main.cjs'ten "işte paylaşılabilecek
//     ekranlar/pencereler" listesi geldiğinde React'ı haberdar eder.
//   - selectScreenSource: React'tan "kullanıcı bunu seçti (ya da
//     iptal etti)" bilgisini main.cjs'e geri gönderir.
// ============================================================

const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onScreenSources: (callback) => {
    const listener = (_event, sources) => callback(sources);
    ipcRenderer.on("screen-sources-available", listener);
    // Aboneliği iptal etmek için bir fonksiyon döndürüyoruz (React
    // tarafında useEffect temizliği için kullanışlı).
    return () => ipcRenderer.removeListener("screen-sources-available", listener);
  },
  selectScreenSource: (sourceId) => {
    ipcRenderer.send("screen-source-selected", sourceId);
  },
  // YENİ: Arayüz yakınlaştırma — tüm pencereyi (yazı, buton, boşluk,
  // her şeyi orantılı) büyütüp küçültüyor. webFrame, Electron'un
  // renderer-seviyesinde zoom kontrolü sağlayan modülü.
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
});

