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
                   invites (süreli/sınırlı davetler), roles (rol renkleri ve yetkileri),
                   presence (durum ve etkinlik), friends (arkadaşlar ve özel mesajlar)
  http/routes.js   istemci dosyaları, durum sayfası, fotoğraf API'si, /davet/KOD
  socket/          connection (el sıkışma), context (bağlantı başına durum: ctx) ve olay
                   grupları: account, servers, channels, voice, admin, roles (roller ve kanal
                   düzenleme), presence (durum, özel durum, boşta, oyun), friends (arkadaşlık
                   ve özel mesaj), messages (sabitleme ve arama), plans (anket ve etkinlik)
desktop/
  electron/        ana süreç (main.cjs: pencere, sistem tepsisi, güncelleme), preload köprüsü,
                   push-to-talk.cjs (global bas-konuş), activity.cjs (oynanan oyun)
  src/App.jsx      uygulamanın durumu ve bağlantı mantığı (bağlantı, ses, istekler)
  src/styles/      base.css: renkler, yazı tipleri, düğme/alan/avatar gibi ortak parçalar
  src/components/  arayüz: AuthScreen, ServerRail, ChannelSidebar, ChannelHeader,
                   ChatPanel (MessageList, Composer), MemberList, VoiceStage
                   (StageTile, Remote*Tile), SettingsScreen, Dialog(s), Avatar
  src/lib/         config, debug, format, sounds, mentions, webrtc, speaking (kim
                   konuşuyor), userColor (kişiye özel renk), notify (masaüstü bildirimi,
                   görev çubuğu sayısı), markdown (mesaj biçimlendirme), invites (davet
                   bağlantısı), micProcessor + voice-gate.worklet (giriş hassasiyeti),
                   screenShare (ekran paylaşımı kalitesi),
                   useDismiss
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

Karşıya giden mikrofon sesi bir ses kapısından geçiyor (`voice-gate.worklet.js`, AudioWorklet:
ses iş parçacığında çalıştığı için pencere arkadayken de yavaşlamıyor). Ses, Ayarlar > Ses ve
görüntü'deki eşiğin altındayken karşıya sessizlik gidiyor. Eşik elle seçilebiliyor ya da
otomatik: son 2 saniyenin en sessiz anı (ortam gürültüsü) + 12 dB, -60 ile -36 dB arasında.
Ses 10 ms geciktiriliyor, böylece kapı kelimenin başını kesmiyor; ses düştükten sonra kapı
350 ms daha açık kalıyor. Bas-konuşta kapı kullanılmıyor. Kapı kurulamazsa (ses motoru
çalışmıyor) mikrofon işlenmeden gidiyor. Tarayıcının gürültü bastırma, yankı engelleme ve
otomatik ses seviyesi ayarları da aynı sayfada; seste değişince mikrofon yeni ayarla yeniden
açılıyor, gönderilen iz aynı kalıyor.

Ekran paylaşımı başlamadan kalite penceresi açılıyor: çözünürlük (720p, 1080p, kaynak), kare
hızı (15, 30, 60) ve içerik (oyun/video: akıcılık öncelikli, yazı/kod: netlik öncelikli,
`contentHint`). Masaüstünde paylaşılacak ekran ya da pencere de aynı pencerede seçiliyor; web'de
"Ekranı seç ve paylaş" tarayıcının seçicisini açıyor. Seçim yakalamaya (`applyConstraints`) ve
her bağlantının ekran kanalına (bit hızı ve kare hızı sınırı, `setParameters`) uygulanıyor.
Görüntü sesteki herkese ayrı gittiği için pencere toplam yükleme hızını da gösteriyor. Kalite
Ayarlar > Ses ve görüntü'den paylaşırken de değişebiliyor (`lib/screenShare.js`). İzleyen
taraf kutucuğu büyütünce yayın sahneyi dolduruyor, diğerleri altta şeride iniyor, yandaki sohbet
açık kalıyor; ekran kutucuğunda tam ekran düğmesi var.

Roller sunucuya özel (`Role` koleksiyonu, üyede `roleIds`). Sunucu sahibi Ayarlar > Roller'den
rol oluşturuyor: ad, renk (listeden), "üye listesinde ayrı göster" ve yetkiler: kanalları
yönet (oluştur, adını değiştir, sil, kimlerin göreceği), mesajları yönet (başkasının mesajını
sil), üyeleri yönet (sahip hariç: çıkar, yasakla, sustur), davet oluştur. Rolleri yönetmek ve sunucuyu silmek sadece
sahibe (ve platform yöneticisine) ait. Bir kanal rollere kısıtlanabiliyor (`allowedRoleIds`);
sahip kısıtlı kanalları da görüyor. Eski kısıtlama (`allowedRoles`, platform rolü adları) hâlâ
geçerli, kanal düzenlenince yerini yenisi alıyor. Bir sunucudaki yetkiler tek yerde hesaplanıyor
(`lib/access.js`: `serverPermissions`, `canViewChannel`); erişim değişince (kanal kısıtlandı,
rol silindi ya da alındı) etkilenenler kanaldan ve sesten çıkarılıyor. Rol silinince sadece o
role açık kanal herkese açılmıyor, sahibe kalıyor. Adın rengi ve üye listesindeki başlık en
üstteki rolden.

Kanal kategorileri (`ChannelCategory`, kanalda `categoryId` ve `position`; `socket/categories.js`):
"Kanalları yönet" yetkisi olan sunucu menüsünden kategori oluşturuyor, başlıktaki düğmelerle
kategoriye kanal açıyor ve kategoriyi düzenliyor ya da siliyor (kanalları silinmiyor, listenin
üstündeki kategorisiz kısma geçiyor). Kanallar ve kategoriler sürükleyip bırakılarak taşınıyor;
telefonda kanalın kategorisi düzenleme penceresinden seçiliyor. Herkes kategoriyi başlığına
tıklayıp kendi ekranında daraltabiliyor (tarayıcıda saklanıyor, açık kanal görünür kalıyor). Sunucu
kanalları görüntülenme sırasıyla veriyor: önce kategorisizler, sonra kategoriler sırayla.

Moderasyon (Ayarlar > Üyeler, "Üyeleri yönet" yetkisi; `server/lib/moderation.js`): yasaklanan
çıkarılıyor ve davetle ya da sabit kodla geri giremiyor (`ServerBan`, yasak Ayarlar'dan
kaldırılabiliyor). Susturulan (5 dakika, 1 saat, 1 gün, 1 hafta; `ServerMember.timeoutUntil`) o
sunucuda süre bitene kadar mesaj, fotoğraf, tepki, anket ve etkinlik yazamıyor, sese giremiyor;
seste ise sesten çıkarılıyor, yazma alanının yerinde ne zaman yazabileceği görünüyor. Özel
mesajlar etkilenmiyor. Sahip ve platform yöneticisi yasaklanamıyor ve susturulamıyor.

Durum ve etkinlik: kişi sol alttan Çevrimiçi, Boşta, Rahatsız etmeyin ya da Görünmez seçiyor ve
süreli bir özel durum yazabiliyor (`User.status`, `User.customStatus`). Rahatsız etmeyin'de
bildirim ve mesaj sesi yok (sayılar yine çıkıyor). Görünmez seçen başkalarına çevrimdışı
görünüyor, seste ise görünüyor. "Çevrimiçi" seçip 10 dakika kullanılmayan kendiliğinden boşta
görünüyor: masaüstünde bilgisayarın boşta süresi (`powerMonitor`), web'de sayfadaki klavye ve
fare. Masaüstü uygulaması çalışan programları bilinen oyunlarla eşleştiriyor
(`electron/activity.cjs`, Windows'ta `tasklist`); arkadaşlara sadece oyunun adı gidiyor,
Ayarlar > Masaüstü'nden kapatılabiliyor. Boşta ve oyun bağlantıya ait, kalıcı değil
(`server/lib/presence.js`).

Özel mesajlar ve arkadaşlar: sunucu şeridinin en üstündeki disko topu ana sayfayı açıyor.
Arkadaşlık isteği adla gönderiliyor (`Friendship`: istek ya da kabul); arkadaşlar ve aynı
sunucudakiler özel mesajlaşabiliyor. Özel mesaj iki kişilik bir kanal (`Channel` kaydında
`serverId` boş, `dmUsers` iki kişi): mesajlar, yanıtlar, tepkiler, fotoğraf, okunmamışlar ve ses
kanallarla aynı altyapıdan geçiyor; sadece iki taraf girebiliyor. Her özel mesaj bahsedilme gibi
bildiriliyor. Özel mesajda sese giren karşıdakini arıyor (`dm-call`; arayan çıkınca
`dm-call-ended`). Ana sayfaya geçmek sesi kapatmıyor; aynı sunucuya dönünce son kanal açılıyor.
Bir kişinin durumu değişince aynı sunucuda olmayan arkadaşları da haber alıyor
(`announceUserPresence`).

Sabitleme ve arama: "Mesajları yönet" yetkisi olan (özel mesajda iki taraf da) mesajı
sabitleyebiliyor (`Message.pinnedAt/pinnedBy`, en fazla 50); başlıktaki raptiye kanalın
sabitlenmiş mesajlarını sağdaki panelde gösteriyor. Başlıktaki arama kutusu sunucunun
görebildiğin bütün kanallarında (özel mesajda o konuşmada) arıyor; `from:Ece` kişiye göre
süzüyor (`socket/messages.js`). Bir sonuca tıklayınca o kanal açılıyor, mesaj yüklenmemişse
eski mesajlar yüklenerek bulunuyor ve vurgulanıyor.

Ses efektleri paneli: seste kontrollerdeki düğmeden alkış, davul, korna gibi kısa efektler
çalınıyor; mikrofondan gitmiyor, sesteki herkesin hoparlöründe çalıyor (hepsi Web Audio ile
üretiliyor, ses dosyası yok: `lib/soundboard.js`). Sunucu sadece hangi efektin çalındığını
iletiyor (`play-sound`, kişi başı 1,5 saniyede bir). Sağırlaştırılmışken ya da Ayarlar > Ses ve
görüntü'den kapatılınca sadece kimin çaldığı görünüyor.

Anket ve etkinlik: yazma alanındaki "+" menüsünden. Anket (soru, 2-6 seçenek, tek ya da çok
seçim) ve etkinlik (başlık, tarih, açıklama) kanala özel bir mesaj olarak gidiyor
(`Message.poll` / `Message.event`, metni başlığı; arama ve bildirimler onunla çalışıyor). Oy
ve katılım (katılıyorum, belki) herkeste anında güncelleniyor; anketi açan bitirebiliyor.
Sunucunun yaklaşan etkinlikleri kanal listesinin üstünde; katılıyorum ya da belki diyene
başlarken (uygulama açıksa) ses ve bildirimle hatırlatılıyor (`socket/plans.js`).

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
  süreli ve sınırlı davet bağlantıları, giriş hassasiyeti (elle, otomatik, bas-konuşta kapalı)
  ve ses işleme ayarları, ekran paylaşımı kalitesi ve yayını büyütme, sunucu rolleri (erişim,
  yetkiler, arayüz), durum ve etkinlik (rahatsız etmeyin, görünmez, özel durum, kendiliğinden
  boşta), arkadaşlık ve özel mesajlar (istek, konuşma, erişim, arama, arayüz), sabitleme ve
  mesajlarda arama, ses efektleri, anket ve etkinlik. Hassasiyet testleri mikrofonu bilinen seviyede sürekli bir tonla
  değiştiriyor (`useSyntheticMic`) ve karşı tarafın hoparlöründen ölçüyor.
- `specs/gorunum.spec.js` — ana ekranların masaüstü ve telefon ekran görüntüleri; rapora
  ekleniyor (`npm run test:gorunum`, sonra `npm run report`).
- `specs/protokol.spec.js` — sunucunun bütün olaylarının temel davranışı.
- `specs/masaustu.spec.js` — gerçek masaüstü uygulamasıyla (Electron) testler: açılış, giriş,
  yeni pencere engeli, tek kopya, tepsiye küçülme, arka planda bas-konuş, `disco://davet`
  bağlantısı, paketlenmiş uygulamadaki gibi `file://`'dan açılınca ses kapısı, ekran paylaşımında
  kaynak seçme penceresi ve kalitenin gerçek yakalamaya uygulanması (bu test sahte izin
  arayüzünü kapatıyor; yoksa Chromium seçiciyi atlayıp ekranı kendisi seçiyor), oynanan oyunun
  görünmesi (program listesi `discoTest.activity` ile sahte veriliyor).
  `desktop/node_modules`
  içindeki Electron kullanılıyor; ana süreç `DISCO_TEST_HOOKS` ile tepsiyi ve klavye kancasını
  testlere açıyor.
- `harness/` — düzeneğin kendisi (vekil, sunucu süreci, örnek veriler, tarayıcı yardımcıları).

Bir tarayıcı sayfasında güvenlik politikası (CSP) bir şeyi engellerse test, başka açıdan geçse
de kırmızıya döner.

Henüz düzeltilmemiş bir hata için test yazarken `test.fail` kullan: doğru davranışı tarif eden
test bugün başarısız olduğu için yeşil görünür. Hata düzelince "beklenmedik şekilde geçti" diye
kırmızıya döner; o zaman `test.fail`'i `test`'e çevir.
