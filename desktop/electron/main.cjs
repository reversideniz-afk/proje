// ============================================================
// ELECTRON ANA SÜREÇ (Main Process)
// ------------------------------------------------------------
// Electron'da İKİ ayrı süreç vardır:
//   1) ANA SÜREÇ (bu dosya) — Node.js ortamında çalışır, işletim
//      sistemiyle konuşur: pencere açar/kapatır, dosya sistemine
//      erişebilir, uygulamanın yaşam döngüsünü yönetir.
//   2) RENDERER SÜREÇ — bizim React uygulamamız, bir web sayfası
//      gibi Chromium içinde çalışır. Node.js API'lerine DOĞRUDAN
//      erişemez (güvenlik nedeniyle) — ihtiyaç olursa preload.js
//      üzerinden köprü kurulur.
//
// Bu ayrım önemli: React kodun (App.jsx vs.) asla bu dosyadaki
// gibi "require", "app", "BrowserWindow" göremez/kullanamaz.
// ============================================================

// NEDEN ".cjs" uzantısı?: package.json'da "type": "module" var (React/Vite
// tarafı modern "import" söz dizimini kullansın diye). Ama bu dosya Node.js'in
// KLASİK modülü require() ile kullanıyor. İkisi package.json seviyesinde
// çakışır — Node hangi kuralı uygulayacağını dosya UZANTISINA bakarak
// karar verir: ".cjs" = her zaman eski usül (CommonJS/require),
// ".mjs" = her zaman yeni usül (ES Modules/import). Bu yüzden Electron
// tarafındaki dosyaları .cjs yaptık, React tarafı .jsx/.js olarak kaldı.
const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu } = require("electron");
const path = require("path");

// app.isPackaged: uygulama .exe/.dmg olarak paketlenip paketlenmediğini
// söylüyor. Paketlenmemişse (yani "npm run dev" ile geliştirme modundaysak)
// isDev true olur.
const isDev = !app.isPackaged;

// YENİ: pencere referansını modül seviyesinde tutuyoruz — ekran paylaşımı
// seçicisi, kaynak listesini bu pencereye (renderer'a) göndermek için
// buna ihtiyaç duyuyor.
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    // "title" pencerenin üst çubuğunda görünen isim
    title: "Sesli Sohbet",
    webPreferences: {
      // preload.js: renderer (React) ile main process arasında GÜVENLİ
      // bir köprü. Şu an için boş ama ileride (ör. sistem bildirimleri
      // için) buraya fonksiyon ekleyeceğiz.
      preload: path.join(__dirname, "preload.cjs"),

      // contextIsolation + nodeIntegration:false = güvenlik standardı.
      // React kodu doğrudan Node.js/dosya sistemine erişemesin diye.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  if (isDev) {
    // Geliştirme modunda: Vite'ın çalıştırdığı canlı geliştirme sunucusuna
    // bağlanıyoruz (kod her değiştiğinde pencere otomatik yenilenir).
    win.loadURL("http://localhost:5173");
    // Geliştirirken tarayıcı konsolunu da (DevTools) otomatik açalım,
    // hata ayıklarken işine yarayacak.
    win.webContents.openDevTools();
  } else {
    // Üretim modunda (paketlenmiş uygulama): Vite'ın derlediği statik
    // dosyaları (dist/index.html) doğrudan dosya sisteminden yüklüyoruz.
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

// Electron hazır olduğunda (işletim sistemiyle bağlantı kurulduğunda)
// pencereyi oluştur.
app.whenReady().then(() => {
  // YENİ: "File Edit View Window" gibi geliştirici görünümlü üst menü
  // çubuğunu tamamen kaldırıyoruz — gerçek bir uygulama gibi hissettirsin
  // diye. Not: DevTools'u manuel açmak istersen (Ctrl+Shift+I) klavye
  // kısayolu hâlâ çalışıyor, sadece görünen menü kayboldu.
  Menu.setApplicationMenu(null);

  // YENİ: Electron'un "sor sormaz her şeyi onayla" varsayılanını
  // KAPATIYORUZ. Kendi listemizi biz belirliyoruz: sadece "media"
  // (kamera/mikrofon) otomatik onaylansın — çünkü uygulamamızın buna
  // gerçekten ihtiyacı var. Konum, bildirim gibi hiç kullanmadığımız
  // başka izinler artık otomatik reddedilecek.
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowedPermissions = ["media"];
      callback(allowedPermissions.includes(permission));
    }
  );

  // YENİ: getDisplayMedia (ekran paylaşımı) isteklerini işliyoruz.
  // Windows'un deneysel "sistem seçici"si (useSystemPicker) her yerde
  // güvenilir çalışmadığı için KENDİ seçim arayüzümüzü kuruyoruz:
  //   1) Paylaşılabilecek ekran/pencere listesini (küçük resimleriyle)
  //      renderer'a (React tarafına) gönderiyoruz.
  //   2) Kullanıcı React arayüzünde birini seçene kadar BEKLİYORUZ
  //      (ipcMain.once — "bir kere gelecek cevabı dinle").
  //   3) Seçim gelince, WebRTC'nin beklediği "callback"i çağırıp
  //      getDisplayMedia() çağrısını tamamlıyoruz.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 300, height: 200 },
      })
      .then((sources) => {
        if (!mainWindow) {
          callback({});
          return;
        }

        // Küçük resimleri React'ın <img> ile gösterebileceği bir metne
        // (data URL) çeviriyoruz — NativeImage nesnesini doğrudan
        // renderer'a gönderemeyiz.
        const sourceList = sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnailDataUrl: source.thumbnail.toDataURL(),
        }));

        mainWindow.webContents.send("screen-sources-available", sourceList);

        // Kullanıcının seçimini (ya da iptalini) TEK SEFERLİK dinliyoruz.
        ipcMain.once("screen-source-selected", (event, sourceId) => {
          const chosen = sources.find((s) => s.id === sourceId);
          if (chosen) {
            callback({ video: chosen });
          } else {
            // sourceId null ise (kullanıcı "İptal" dedi) ya da eşleşme
            // yoksa, paylaşımı reddediyoruz.
            callback({});
          }
        });
      })
      .catch(() => {
        callback({});
      });
  });

  createWindow();

  // macOS'a özgü davranış: dock'tan uygulamaya tekrar tıklanınca
  // (tüm pencereler kapalıyken) yeni pencere aç.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Tüm pencereler kapatıldığında uygulamadan çık (macOS hariç —
// macOS'ta uygulamalar pencere kapanınca da dock'ta açık kalma
// alışkanlığındadır, bu yüzden platform kontrolü yapıyoruz).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
