# Disco

Arkadaş grubu için sesli, görüntülü ve yazılı sohbet uygulaması.

| Klasör     | İçerik                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| `desktop/` | Masaüstü uygulaması: Electron + React + Vite. Aynı kod web/PWA olarak da derleniyor. |
| `server/`  | Sinyalleşme sunucusu: Express + Socket.IO + MongoDB (Render'da çalışıyor). |
| `tests/`   | Uçtan uca test düzeneği (aşağıda).                                     |

### Kod düzeni

```
server/
  server.js        giriş noktası (Render "node server.js" ile başlatıyor)
  db.js            MongoDB şemaları
  lib/             paylaşılan parçalar: realtime (Express + Socket.IO), state (bellekteki
                   odalar), sessions, access, users, limits, validate, rooms, ice
  http/routes.js   istemci dosyaları, durum sayfası, fotoğraf API'si
  socket/          connection (el sıkışma), context (bağlantı başına durum: ctx) ve olay
                   grupları: account, servers, channels, voice, admin
desktop/
  electron/        ana süreç (main.cjs) ve preload köprüsü
  src/App.jsx      uygulamanın kendisi
  src/lib/         config, debug, format, sounds, mentions, webrtc
  src/components/  RemoteCameraTile, RemoteScreenTile, EyeIcon, ZoomControl
```

Uygulama tek bir Socket.IO bağlantısı kullanıyor: açılışta kuruluyor, oturum anahtarı el
sıkışmada gidiyor. Seste her kişiyle tek bir WebRTC bağlantısı ve sabit dört kanal var
(mikrofon, kamera, ekran, ekran sesi); açıp kapamak sadece kanalın izini değiştiriyor.

## Geliştirme

```sh
cd desktop
npm install
npm run dev        # Vite + Electron, Render'daki sunucuya bağlanır
npm run release    # yeni sürümü derleyip GitHub Releases'e yükler (otomatik güncelleme)
```

İstemcinin bağlandığı sunucu `desktop/vite.config.js` içindeki adresten geliyor. Başka bir
sunucuya bağlanmak için derlerken `VITE_SERVER_URL` ortam değişkenini ver.

Sunucu `.env` dosyasını kendisi okumaz; ortam değişkenleri (`MONGODB_URI`, `REGISTER_INVITE_CODE`,
`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`) Render panelinden geliyor. Yerelde
`node --env-file=.env server.js` ile çalıştırabilirsin, ama `.env` gerçek Atlas veritabanını
gösteriyorsa canlı verileri değiştirirsin. Değişiklikleri denemek için testleri kullan.

### Teşhis kayıtları

WebRTC/ses teşhis kayıtları varsayılan olarak kapalı (`npm run dev` ile açık). Paketlenmiş
uygulamada açmak için Ctrl+Shift+I ile konsolu aç, `localStorage.setItem('discoDebug', '1')`
yaz ve uygulamayı yeniden başlat. Kapatmak için `localStorage.removeItem('discoDebug')`.

## Testler

```sh
cd tests
npm install
npm test           # hepsi (~3-4 dakika)
npm run test:smoke # sadece temel akışlar
npm run report     # son çalıştırmanın raporu: ekran görüntüleri, konsol ve sunucu kayıtları
```

Gerekenler: Microsoft Edge (testler kurulu Edge'i kullanır) ve `desktop/` ile `server/` için
yapılmış `npm install`. İlk çalıştırmada MongoDB 7.0.24 bir kez indirilir (~600 MB, kullanıcı
önbelleğine).

Her test sıfırdan kurulan bir ortamda çalışır: bellek içi MongoDB'de örnek verilerle dolu yeni
bir veritabanı, buna bağlı **değiştirilmemiş** `server/server.js`, istemcinin yerel sunucuya
bağlanacak şekilde ayrı bir klasöre derlenmiş hali, araya bağlantı kesmeye ve sunucuyu yeniden
başlatmaya yarayan bir vekil, sahte kamera ve mikrofonlu başsız Edge. Gerçek Render sunucusuna
ve Atlas veritabanına hiç bağlanılmaz.

Dosyalar:

- `specs/temel.spec.js` — bugün çalışan akışlar. Hepsi her zaman geçmeli.
- `specs/faz1-ses-oturum.spec.js` — Faz 1'de düzeltilen hataların (H1–H14, H30, H31) kalıcı
  testleri. Hepsi her zaman geçmeli.
- `specs/faz2-guvenlik.spec.js` — Faz 2'de düzeltilen güvenlik ve yetki hatalarının (H6–H8,
  H11, H17–H20) kalıcı testleri.
- `specs/faz3-mimari.spec.js` — tek bağlantı, sunucu odaları ve anında güncellemeler (H16), sunucu
  genelinde çevrimiçi bilgisi, her eşle tek WebRTC bağlantısı.
- `specs/protokol.spec.js` — sunucunun bütün olaylarının temel davranışı.
- `specs/masaustu.spec.js` — gerçek masaüstü uygulamasıyla (Electron) testler: açılış, giriş,
  yeni pencere engeli, tek kopya. `desktop/node_modules` içindeki Electron kullanılıyor.
- `harness/` — düzeneğin kendisi (vekil, sunucu süreci, örnek veriler, tarayıcı yardımcıları).

Henüz düzeltilmemiş bir hata için test yazarken `test.fail` kullan: doğru davranışı tarif eden
test bugün başarısız olduğu için yeşil görünür. Hata düzelince "beklenmedik şekilde geçti" diye
kırmızıya döner; o zaman `test.fail`'i `test`'e çevir.
