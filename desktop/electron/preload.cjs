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
  // YENİ: çerçevesiz tam ekran düğmesi — gerçek pencere kontrolü main
  // process'te olduğu için IPC üzerinden.
  toggleFullscreen: () => ipcRenderer.send("toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("is-fullscreen"),
  onFullscreenChange: (callback) => {
    const listener = (_event, isFullscreen) => callback(isFullscreen);
    ipcRenderer.on("fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("fullscreen-changed", listener);
  },
  // YENİ: Discord tarzı otomatik güncelleme — gerçek indirme/kurulum
  // main process'te (electron-updater), React tarafı sadece durumu
  // dinleyip bir düğme gösteriyor.
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  installUpdate: () => ipcRenderer.send("install-update"),
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.removeListener("update-available", listener);
  },
  onUpdateNotAvailable: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("update-not-available", listener);
    return () => ipcRenderer.removeListener("update-not-available", listener);
  },
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update-download-progress", listener);
    return () => ipcRenderer.removeListener("update-download-progress", listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on("update-downloaded", listener);
    return () => ipcRenderer.removeListener("update-downloaded", listener);
  },
  onUpdateError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("update-error", listener);
    return () => ipcRenderer.removeListener("update-error", listener);
  },
});

