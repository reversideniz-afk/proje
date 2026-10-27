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
const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
// YENİ: Discord'daki gibi uygulama içi otomatik güncelleme. GitHub
// Releases'i "publish" kaynağı olarak kullanıyor (bkz. package.json
// "build.publish") — her yeni sürüm orada bir Release olarak
// yayınlandığında, açık olan uygulamalar bunu fark edip indiriyor.
const { autoUpdater } = require("electron-updater");

// app.isPackaged: uygulama .exe/.dmg olarak paketlenip paketlenmediğini
// söylüyor. Paketlenmemişse (yani "npm run dev" ile geliştirme modundaysak)
// isDev true olur.
const isDev = !app.isPackaged;

// Pencerede açılacak adres: geliştirmede Vite'ın sunucusu, paketlenmiş
// uygulamada dist/index.html. DISCO_APP_URL sadece test düzeneği için
// (uygulamayı kendi derlediği sürümle açıyor); normal kullanımda boş.
const appUrl =
  process.env.DISCO_APP_URL ||
  (isDev ? "http://localhost:5173" : pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href);

// Disco aynı anda tek kopya çalışıyor: ikinci kez açılınca yeni pencere
// yerine açık olan öne geliyor. Eskiden iki kopya açılabiliyordu; bu da
// aynı hesapla iki bağlantı ve mikrofon çakışması demekti (H19).
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

const isWebLink = (url) => /^https?:\/\//i.test(url);

// YENİ: pencere referansını modül seviyesinde tutuyoruz — ekran paylaşımı
// seçicisi, kaynak listesini bu pencereye (renderer'a) göndermek için
// buna ihtiyaç duyuyor.
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    // "title" pencerenin üst çubuğunda görünen isim
    title: "Disco",
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

  // DÜZELTME: Menu.setApplicationMenu(null) (aşağıda), menüye bağlı
  // varsayılan Ctrl+Shift+I kısayolunu da beraberinde götürüyormuş —
  // önceki yorumumuzda "hâlâ çalışıyor" demişiz ama yanılmışız. Bunu
  // menüden TAMAMEN bağımsız, doğrudan bir tuş dinleyicisiyle
  // düzeltiyoruz — artık menü gizli olsa bile kesin çalışır.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "i") {
      win.webContents.toggleDevTools();
    }
  });

  // YENİ: çerçevesiz tam ekran düğmesi — pencere zaten çerçevesiz DEĞİL
  // (normal başlık çubuğu var), ama setFullScreen(true) OS'in kendi tam
  // ekran moduna geçiriyor (F11'e basmışsın gibi) — başlık çubuğu da,
  // görev çubuğu da gidiyor. React tarafı sadece 'toggle-fullscreen'
  // gönderiyor, gerçek pencere durumu (F11 ya da başka bir yoldan
  // değişse bile) 'fullscreen-changed' ile geri bildiriliyor ki
  // düğmenin ikonu her zaman doğru göstersin.
  win.on("enter-full-screen", () => {
    win.webContents.send("fullscreen-changed", true);
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("fullscreen-changed", false);
  });

  // Uygulama penceresinden yeni pencere açılmıyor: http(s) linkleri
  // varsayılan tarayıcıda açılıyor, gerisi (ör. data: adresleri)
  // reddediliyor. Eskiden window.open çıplak bir Electron penceresi
  // açıyordu (H19).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Ana pencere de uygulamanın kendi sayfasından başka bir yere gidemez.
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === appUrl.split("#")[0]) return;
    event.preventDefault();
    if (isWebLink(url)) shell.openExternal(url);
  });

  // Geliştirmede Vite'ın canlı sunucusu (kod değişince pencere kendiliğinden
  // yenilenir), paketlenmiş uygulamada dist/index.html. NOT: DevTools
  // otomatik açılmıyor, gerektiğinde Ctrl+Shift+I.
  win.loadURL(appUrl);
}

// Electron hazır olduğunda (işletim sistemiyle bağlantı kurulduğunda)
// pencereyi oluştur.
app.whenReady().then(() => {
  // İkinci kopya: yukarıda kapanması istendi, pencere açmasın.
  if (!hasSingleInstanceLock) return;

  // YENİ: "File Edit View Window" gibi geliştirici görünümlü üst menü
  // çubuğunu tamamen kaldırıyoruz — gerçek bir uygulama gibi hissettirsin
  // diye. DevTools'u manuel açmak (Ctrl+Shift+I) için gereken kısayol,
  // yukarıda ayrıca (menüden bağımsız olarak) tanımlandı.
  Menu.setApplicationMenu(null);

  // YENİ: çerçevesiz tam ekran düğmesi için IPC.
  ipcMain.on("toggle-fullscreen", () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.handle("is-fullscreen", () => {
    return mainWindow ? mainWindow.isFullScreen() : false;
  });
  // YENİ: Ayarlar panelinde hangi sürümün çalıştığını gösterebilmek için.
  ipcMain.handle("get-app-version", () => app.getVersion());

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
            // YENİ: "loopback" — seçilen ekranın/pencerenin görüntüsüyle
            // BİRLİKTE, bilgisayarın sistem sesini de (video oynatıyorsan
            // onun sesi, oyun sesi vb.) yakalıyoruz.
            callback({ video: chosen, audio: "loopback" });
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

  // YENİ: Otomatik güncelleme — SADECE paketlenmiş (kurulmuş) uygulamada
  // anlamlı; "npm run dev" ile çalışırken hiç güncelleme kaynağı/sürüm
  // bilgisi olmadığı için deneme bile yapmıyoruz.
  if (!isDev) {
    autoUpdater.logger = console;
    // autoDownload: bir güncelleme bulununca SESSİZCE arka planda inmeye
    // başlasın (Discord'un yaptığı gibi) — kullanıcıya sadece indirme
    // BİTİNCE "yeniden başlat" düğmesi gösteriyoruz, ayrıca bir "indir"
    // onayı istemiyoruz.
    autoUpdater.autoDownload = true;
    // İndirilen güncelleme, "Yeniden başlat"a basılmasa da uygulama
    // kapanırken kuruluyor. Eskiden düğmeye basılmazsa hiç kurulmuyordu.
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
      mainWindow?.webContents.send("update-available", { version: info.version });
    });
    // YENİ: "Güncellemeleri kontrol et" butonuna manuel basıldığında,
    // güncel olduğunu da React tarafına bildirebilelim diye.
    autoUpdater.on("update-not-available", () => {
      mainWindow?.webContents.send("update-not-available");
    });
    autoUpdater.on("download-progress", (progress) => {
      mainWindow?.webContents.send("update-download-progress", {
        percent: Math.round(progress.percent),
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      mainWindow?.webContents.send("update-downloaded", { version: info.version });
    });
    autoUpdater.on("error", (err) => {
      console.error("[güncelleme] hata:", err?.message || err);
      mainWindow?.webContents.send("update-error", err?.message || String(err));
    });

    // Açılışta bir kere kontrol et. Hata olursa (ör. internet yok,
    // henüz hiç Release yayınlanmamış) sessizce yutuyoruz — kullanıcının
    // normal kullanımını hiç etkilememeli.
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[güncelleme] kontrol hatası:", err?.message || err);
    });
  }

  // YENİ: React tarafı manuel "güncellemeleri kontrol et" ve (indirme
  // bitince) "yeniden başlat ve kur" tetikleyebilsin diye.
  ipcMain.on("check-for-updates", () => {
    if (isDev) return;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[güncelleme] kontrol hatası:", err?.message || err);
    });
  });
  ipcMain.on("install-update", () => {
    if (isDev) return;
    autoUpdater.quitAndInstall();
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

