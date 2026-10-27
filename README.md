# Disco

Arkadaş grubu için sesli, görüntülü ve yazılı sohbet uygulaması.

| Klasör     | İçerik                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| `desktop/` | Masaüstü uygulaması: Electron + React + Vite. Aynı kod web/PWA olarak da derleniyor. |
| `server/`  | Sinyalleşme sunucusu: Express + Socket.IO + MongoDB (Render'da çalışıyor). |
| `tests/`   | Uçtan uca test düzeneği (aşağıda).                                     |

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
- `specs/faz1-bilinen-hatalar.spec.js`, `specs/faz2-bilinen-hatalar.spec.js` — Disco Gelişim
  Raporu'ndaki hatalar (H1, H2…). Her biri doğru davranışı tarif ediyor ve `test.fail` ile
  "beklenen başarısızlık" olarak işaretli, yani bugün başarısız oldukları için yeşil görünüyorlar.
  Bir hatayı düzeltince testi "beklenmedik şekilde geçti" diye kırmızı görürsün: `test.fail`'i
  `test`'e çevir, o test artık hatanın geri dönmesine karşı kalıcı bir koruma olur.
- `harness/` — düzeneğin kendisi (vekil, sunucu süreci, örnek veriler, tarayıcı yardımcıları).
