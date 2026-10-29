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
                   odalar), sessions, access, users, limits, validate, rooms, ice,
                   avatars (avatar adresleri), unread (okunmamışlar ve bahsedilmeler),
                   invites (süreli/sınırlı davetler)
  http/routes.js   istemci dosyaları, durum sayfası, fotoğraf API'si, /davet/KOD
  socket/          connection (el sıkışma), context (bağlantı başına durum: ctx) ve olay
                   grupları: account, servers, channels, voice, admin
desktop/
  electron/        ana süreç (main.cjs: pencere, sistem tepsisi, güncelleme), preload köprüsü,
                   push-to-talk.cjs (global bas-konuş)
  src/App.jsx      uygulamanın durumu ve bağlantı mantığı (bağlantı, ses, istekler)
  src/styles/      base.css: renkler, yazı tipleri, düğme/alan/avatar gibi ortak parçalar
  src/components/  arayüz: AuthScreen, ServerRail, ChannelSidebar, ChannelHeader,
                   ChatPanel (MessageList, Composer), MemberList, VoiceStage
                   (StageTile, Remote*Tile), SettingsScreen, Dialog(s), Avatar
  src/lib/         config, debug, format, sounds, mentions, webrtc, speaking (kim
                   konuşuyor), userColor (kişiye özel renk), notify (masaüstü bildirimi,
                   görev çubuğu sayısı), markdown (mesaj biçimlendirme), invites (davet
                   bağlantısı), useDismiss
```

Tasarım "gece kulübü": koyu mor gece zemin, Ayarlar > Görünüm'den seçilen tek vurgu rengi ve
sadece "konuşuyor / canlı" için Spot ışığı (`#66e0c2`). Yazı tipleri Unbounded (başlıklar),
Onest (metin) ve JetBrains Mono (saat, ping); @fontsource paketleriyle uygulamanın içine
gömülü. Simgeler Lucide. Seste konuşan kişinin avatarının etrafında disko topu ışığı gibi
dönen halka var; hareket azaltma açıksa sabit duruyor.

Uygulama tek bir Socket.IO bağlantısı kullanıyor: açılışta kuruluyor, oturum anahtarı el
sıkışmada gidiyor. Seste her kişiyle tek bir WebRTC bağlantısı ve sabit dört kanal var
(mikrofon, kamera, ekran, ekran sesi); açıp kapamak sadece kanalın izini değiştiriyor.
Mikrofon sese girerken kapalı hazırlanıyor; açmak ya da bas-konuş tuşuna basmak sadece izi
açıyor.

Okunmamışlar kalıcı: sunucu her kanal için kişinin en son ne zaman okuduğunu tutuyor
(`ChannelMember.lastReadAt`; istemci kanal açık ve pencere öndeyken bildiriyor). Giriş
yapan bağlantı erişebildiği bütün kanalların bildirim odalarına giriyor; başka kanaldaki
yeni mesaj kanalda okunmamış işareti, bahsedilince sayı, Ayarlar > Bildirimler'e göre
masaüstü bildirimi ve görev çubuğunda sayı olarak görünüyor.

Davetler sunucu menüsündeki "Arkadaşını davet et"ten oluşturuluyor: süresi (1 saat, 1 gün,
7 gün ya da süresiz) ve kaç kişinin kullanabileceği seçiliyor. Bağlantı `SUNUCU/davet/KOD` biçiminde; açınca
web uygulaması giriş ekranında hangi sunucuya davet edildiğini gösteriyor, girişten sonra
katılma penceresini açıyor. Masaüstü uygulaması `disco://davet/KOD` bağlantılarını kendisi
açıyor (Windows'ta kurulumla kaydediliyor; uygulama açıksa bağlantı açık olan pencereye
gidiyor). Davetler `Invite` koleksiyonunda; süresi dolan MongoDB tarafından siliniyor, kullanım
sayısı tek bir koşullu güncellemeyle artıyor. Sunucunun sabit davet kodu da hâlâ çalışıyor.
Sahip, açık davetleri Ayarlar > Sunucu'dan görüp iptal edebiliyor.

Masaüstü uygulamasında bas-konuş tuşu işletim sistemi seviyesinde dinleniyor
(`uiohook-napi`): oyundayken ve Disco tepsideyken de çalışıyor. Klavye kancası sadece seste ve
bas-konuş açıkken çalışıyor; arayüze sadece o tuşun basılıp bırakıldığı gidiyor. Pencereyi
kapatmak Disco'yu tepsiye küçültüyor (Ayarlar > Masaüstü'nden kapatılabiliyor); tamamen
çıkmak için tepsideki simgeye sağ tıkla.

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
- `specs/faz4-tasarim.spec.js` — Faz 4'te düzeltilen hataların (H15, H21–H24, H26, H27) ve yeni
  arayüz davranışlarının (kim konuşuyor, gruplama, emoji, kanal oluşturma, ayarlar) testleri.
- `specs/faz5-ozellikler.spec.js` — Faz 5: mikrofonun sese girerken hazırlanması (H28), seste
  mikrofon değiştirme, bas-konuş tuşu (klavye ve fare) ve kalıcılığı, kalıcı okunmamışlar ve
  bahsedilmeler, masaüstü bildirimi, "Yeni" çizgisi, açık sunucuya tekrar tıklama (H33), mesaja
  yanıt ve biçimlendirme (kalın, italik, kod, spoiler, alıntı, link; HTML düz metin kalıyor),
  süreli ve sınırlı davet bağlantıları.
- `specs/gorunum.spec.js` — ana ekranların masaüstü ve telefon ekran görüntüleri; rapora
  ekleniyor (`npm run test:gorunum`, sonra `npm run report`).
- `specs/protokol.spec.js` — sunucunun bütün olaylarının temel davranışı.
- `specs/masaustu.spec.js` — gerçek masaüstü uygulamasıyla (Electron) testler: açılış, giriş,
  yeni pencere engeli, tek kopya, tepsiye küçülme, arka planda bas-konuş, `disco://davet`
  bağlantısı. `desktop/node_modules`
  içindeki Electron kullanılıyor; ana süreç `DISCO_TEST_HOOKS` ile tepsiyi ve klavye kancasını
  testlere açıyor.
- `harness/` — düzeneğin kendisi (vekil, sunucu süreci, örnek veriler, tarayıcı yardımcıları).

Bir tarayıcı sayfasında güvenlik politikası (CSP) bir şeyi engellerse test, başka açıdan geçse
de kırmızıya döner.

Henüz düzeltilmemiş bir hata için test yazarken `test.fail` kullan: doğru davranışı tarif eden
test bugün başarısız olduğu için yeşil görünür. Hata düzelince "beklenmedik şekilde geçti" diye
kırmızıya döner; o zaman `test.fail`'i `test`'e çevir.
