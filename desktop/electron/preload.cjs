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
  // Global bas-konuş: tuş atanınca ana süreç işletim sistemi seviyesinde
  // dinliyor ve sadece o tuşun basılıp bırakıldığını bildiriyor.
  setPushToTalkKey: (code) => ipcRenderer.invoke("set-push-to-talk-key", code),
  // Oynanan oyun: algılamayı aç/kapa, oyun değişince haber al.
  setActivityDetection: (enabled) => ipcRenderer.send("set-activity-detection", enabled),
  onActivity: (callback) => {
    const listener = (_event, game) => callback(game);
    ipcRenderer.on("activity-changed", listener);
    return () => ipcRenderer.removeListener("activity-changed", listener);
  },
  getSystemIdleTime: () => ipcRenderer.invoke("get-system-idle-time"),
  onPushToTalk: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("push-to-talk", listener);
    return () => ipcRenderer.removeListener("push-to-talk", listener);
  },
  // Kapat düğmesi tepsiye küçültsün mü; bilgisayar açılınca başlasın mı.
  setCloseToTray: (value) => ipcRenderer.send("set-close-to-tray", value),
  // Bahsedilince görev çubuğunda yanıp sönme ve sayı; bildirime tıklayınca
  // pencereyi (tepsideyse de) öne getirme.
  flashFrame: () => ipcRenderer.send("flash-frame"),
  setBadge: (count, image) => ipcRenderer.send("set-badge", { count, image }),
  showWindow: () => ipcRenderer.send("show-window"),
  // disco://davet/KOD ile gelen davet: açılışta bekleyen ve sonradan gelenler.
  takePendingInvite: () => ipcRenderer.invoke("take-pending-invite"),
  onOpenInvite: (callback) => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on("open-invite", listener);
    return () => ipcRenderer.removeListener("open-invite", listener);
  },
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  setOpenAtLogin: (value) => ipcRenderer.invoke("set-open-at-login", value),
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

