// ============================================================
// VERİTABANI BAĞLANTISI VE KULLANICI ŞEMASI
// ------------------------------------------------------------
// Burada sadece KİŞİSEL HESAPLAR (kullanıcı adı + hash'lenmiş şifre)
// tutuluyor. Kanal şifreleri burada DEĞİL — onlar server.js'te,
// ortam değişkenlerinden (basit, paylaşılan yapılandırma olduğu için
// tam bir veritabanı kaydı gerektirmiyor).
// ============================================================

const mongoose = require("mongoose");

// ÖNEMLİ (sağlamlık): Varsayılan olarak mongoose, bağlantı kurulana kadar
// sorguları "kuyruğa alıp" bekletir — bağlantı hiç kurulamazsa bu,
// sorgunun SONSUZA KADAR asılı kalmasına yol açabilir. Bunun yerine
// bağlı değilken sorguların HEMEN hata vermesini istiyoruz (try/catch
// ile düzgünce yakalayabilelim diye).
mongoose.set("bufferCommands", false);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  // ÖNEMLİ: Şifrenin kendisi DEĞİL, "hash"i (geri döndürülemez, tek
  // yönlü şifrelenmiş hali) saklanıyor. Veritabanına biri sızsa bile
  // eline gerçek şifreler geçmez.
  passwordHash: { type: String, required: true },
  // YENİ: Discord'daki rol mantığı gibi — her kullanıcının bir ya da
  // daha fazla etiketi (rolü) olabilir (ör. "Yönetici", "Arkadaş").
  // Kanallar artık şifreyle değil, bu rollere göre erişime açılıyor.
  roles: { type: [String], default: [] },
  // YENİ: Profil fotoğrafı — küçük bir base64 data URL olarak saklanıyor
  // (send-photo'daki geçici fotoğraflardan FARKLI olarak burası KALICI).
  // Boyutu server.js'teki 'set-avatar' işleyicisinde sınırlıyoruz ki
  // veritabanı büyük resimlerle şişmesin.
  avatarData: { type: String, default: null },
  // Avatarın değiştiği an: resmin adresindeki sürüm buradan geliyor (bkz.
  // lib/avatars.js). Bu alan eklenmeden önce yüklenmiş fotoğraflarda boş.
  avatarUpdatedAt: { type: Date, default: null },
  // Durum (online, idle, dnd, invisible) ve özel durum { text, expiresAt }
  // (bkz. lib/presence.js).
  status: { type: String, default: "online" },
  customStatus: { type: mongoose.Schema.Types.Mixed, default: null },
  // YENİ: Giriş denemesi sınırlama (rate limiting) — 5 yanlış şifreden
  // sonra hesap geçici kilitleniyor (bkz. server.js login işleyicisi).
  // loginLockedUntil geçmişte/null ise hesap kilitli DEĞİL. Alganis
  // rolündeki bir hesap, Üye Yönetimi panelinden bunu erken açabilir.
  failedLoginAttempts: { type: Number, default: 0 },
  loginLockedUntil: { type: Date, default: null },
});

// mongoose.models.User kontrolü: bu dosya birden fazla yerden
// (server.js ve add-user.js scripti) çağrılabiliyor, aynı modelin
// iki kere tanımlanmaya çalışılmasını önlüyor.
const User = mongoose.models.User || mongoose.model("User", userSchema);

// YENİ: Sohbet mesajları — kalıcı, hiç silinmiyor. Her kanalın kendi
// mesaj geçmişi "channel" alanına göre ayrılıyor.
// Anket: soru, seçenekler ve her seçeneğe oy verenler; multiple ise birden
// fazla seçenek seçilebiliyor, closed ise oylama bitti.
const pollSchema = new mongoose.Schema(
  {
    question: String,
    multiple: { type: Boolean, default: false },
    closed: { type: Boolean, default: false },
    options: [new mongoose.Schema({ text: String, votes: { type: [String], default: [] } }, { _id: false })],
  },
  { _id: false }
);

// Etkinlik: başlık, başlangıç, açıklama; katılıyorum ve belki diyenler.
const eventSchema = new mongoose.Schema(
  {
    title: String,
    startsAt: Date,
    description: { type: String, default: "" },
    going: { type: [String], default: [] },
    maybe: { type: [String], default: [] },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema({
  // ESKİ: kanal ismi düz metin olarak tutuluyordu — çoklu sunucuya
  // geçişte iki farklı sunucunun aynı isimde kanal açması çakışma
  // yaratacağından channelId'ye taşındı. Geçiş betiği tamamlanana kadar
  // (ve bir süre sonrasında da güvenlik payı olarak) ikisi bir arada
  // duruyor, artık asıl kaynak channelId.
  channel: { type: String, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", index: true },
  username: { type: String, required: true },
  text: { type: String, required: true, maxlength: 2000, trim: true },
  createdAt: { type: Date, default: Date.now },
  // YENİ: mesaj düzenlenmişse ne zaman düzenlendiği (arayüzde "(düzenlendi)" göstermek için).
  editedAt: { type: Date, default: null },
  // Yanıt verilen mesajın o anki kısa kopyası: asıl mesaj sonradan silinse
  // ya da eski mesajlar yüklenmemiş olsa da önizleme gösterilebiliyor.
  replyTo: {
    type: {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
      username: String,
      text: String,
    },
    default: undefined,
    _id: false,
  },
  // YENİ: emoji tepkileri — [{ emoji: "👍", username: "Alganis" }, ...]
  // Aynı kişi aynı emojiyi tekrar tıklarsa, o kaydı siliyoruz (aç/kapa).
  reactions: {
    type: [{ emoji: String, username: String, _id: false }],
    default: [],
  },
  // Sabitlenmiş mesaj: kim, ne zaman (bkz. toggle-pin).
  pinnedAt: { type: Date, default: null },
  pinnedBy: { type: String, default: null },
  // Anket ya da etkinlik mesajı (bkz. socket/plans.js); metin başlığı.
  poll: { type: pollSchema, default: undefined },
  event: { type: eventSchema, default: undefined },
});
// Kanalın son mesajları ve "şu andan sonraki mesajlar" sorguları için.
messageSchema.index({ channelId: 1, createdAt: -1 });
const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

// YENİ: Bir kişi bir kanala (metin olarak) katıldığında buraya kaydı
// düşüyor — "bu kanalda hiç bulunmuş biri" listesini (çevrimdışı
// üyeler) gösterebilmek için. Sesle hiç ilgisi yok, sadece "kanalı
// hiç açmış mı" bilgisini tutuyor.
const channelMemberSchema = new mongoose.Schema({
  // ESKİ alan — bkz. messageSchema'daki aynı not, artık asıl kaynak channelId.
  channel: { type: String },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel" },
  username: { type: String, required: true },
  lastSeenAt: { type: Date, default: Date.now },
  // Kanalı en son ne zaman okuduğu (kanal açık ve pencere öndeyken istemci
  // bildiriyor). Okunmamışlar ve "Yeni" çizgisi buna göre (bkz. lib/unread.js).
  lastReadAt: { type: Date, default: null },
});
channelMemberSchema.index({ channelId: 1, username: 1 }, { unique: true, sparse: true });
const ChannelMember =
  mongoose.models.ChannelMember || mongoose.model("ChannelMember", channelMemberSchema);

// YENİ: Kayıt (register) uç noktasına karşı saldırı niteliğinde (kısa
// sürede çok sayıda yanlış davet kodu deneyen) bir IP adresi KALICI
// olarak buraya kaydediliyor — sunucu yeniden başlasa bile ban devam
// etsin diye (bkz. server.js — banlıIpSet, açılışta buradan doldurulur).
const bannedIpSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true },
  reason: { type: String, default: "" },
  attemptCount: { type: Number, default: 0 },
  bannedAt: { type: Date, default: Date.now },
});
const BannedIp = mongoose.models.BannedIp || mongoose.model("BannedIp", bannedIpSchema);

// YENİ: "Beni hatırla" — kullanıcı bunu işaretlerse, giriş belirteci
// (token) burada KALICI olarak saklanıyor (server.js'teki bellek-içi
// sessionTokens haritası sunucu yeniden başlayınca sıfırlanır, bu ise
// kalır). expiresAt geçmişse token artık geçersiz sayılıyor — her
// başarılı "resume-session" isteğinde süre yenileniyor (kayan pencere).
// Artık BÜTÜN girişler burada (beni hatırla seçilmese de), böylece sunucu
// yeniden başlayınca kimse atılmıyor. "token" alanında anahtarın kendisi
// değil SHA-256 özeti duruyor: veritabanı sızsa bile oturum çalınamaz.
// Eski kayıtlarda anahtarın kendisi duruyordu; ilk kullanımda özete
// çevriliyorlar (bkz. server.js, findSession).
const sessionSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  // false: "beni hatırla" seçilmemiş, kısa ömürlü oturum. Eski kayıtların
  // hepsi beni hatırla ile açılmıştı, varsayılan o yüzden true.
  rememberMe: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
});
// Süresi dolan oturumları MongoDB kendisi siliyor (TTL index).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);

// YENİ: Çoklu sunucu desteği — her kullanıcı kendi bağımsız "sunucusunu"
// (kendi kanalları, kendi üyeleri) açabiliyor, Discord'daki gibi. Sunucuyu
// açan kişi o sunucunun tek adminidir (ADMIN_ROLE'deki platform admini
// ayrıca her sunucuya otomatik erişir — bkz. server.js, üyelik satırına
// ihtiyaç duymadan).
const serverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  ownerUsername: { type: String, required: true },
  // Bu sunucuya katılmak için paylaşılan davet kodu/linki.
  inviteCode: { type: String, required: true, unique: true },
  // Sunucu simgesi (küçük data: adresi, profil fotoğrafı gibi). Listelere
  // sadece adresi gidiyor (bkz. lib/avatars.js serverIconUrl); simge
  // yokken iconUpdatedAt de boş.
  iconData: { type: String, default: null },
  iconUpdatedAt: { type: Date, default: null },
  // Simge GIF ise true: istemci durağan kareyi gösterip üzerine gelince oynatıyor.
  iconAnimated: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Server = mongoose.models.Server || mongoose.model("Server", serverSchema);

// Sunucu sahibinin oluşturduğu süreli ya da kullanım sayısı sınırlı davet
// bağlantıları (bkz. lib/invites.js). Süresi dolan kayıt kendiliğinden siliniyor.
const inviteSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true, index: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
  maxUses: { type: Number, default: 0 }, // 0: sınırsız
  uses: { type: Number, default: 0 },
});
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Invite = mongoose.models.Invite || mongoose.model("Invite", inviteSchema);

// YENİ: Bir kullanıcının hangi sunucu(lar)a üye olduğunu tutar. Sadece
// üyelik kaydı olanlar (ya da platform admini) o sunucuyu/kanallarını
// görebilir.
const serverMemberSchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true },
  username: { type: String, required: true },
  isOwner: { type: Boolean, default: false },
  // Sunucuya özel rolleri (bkz. Role).
  roleIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // Susturma: bu zamana kadar bu sunucuda yazamıyor ve sese giremiyor
  // (bkz. lib/moderation.js).
  timeoutUntil: { type: Date, default: null },
  joinedAt: { type: Date, default: Date.now },
});
serverMemberSchema.index({ serverId: 1, username: 1 }, { unique: true });
const ServerMember =
  mongoose.models.ServerMember || mongoose.model("ServerMember", serverMemberSchema);

// Sunucudan yasaklananlar: çıkarılıyor ve davetle ya da sabit kodla geri
// giremiyor (yasak kaldırılana kadar).
const serverBanSchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true },
  username: { type: String, required: true },
  bannedBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
serverBanSchema.index({ serverId: 1, username: 1 }, { unique: true });
const ServerBan = mongoose.models.ServerBan || mongoose.model("ServerBan", serverBanSchema);

// YENİ: Kanallar artık ortam değişkenlerinden değil, veritabanından
// geliyor — her kanal bir sunucuya bağlı. allowedRoles boşsa o sunucunun
// TÜM üyelerine açık demek (env tabanlı eski CHANNEL_N_ROLES ile aynı
// mantık).
// Özel mesaj da bir kanal: sunucusu yok (serverId null), dmUsers iki kişi,
// adı iki kişinin anahtarı (bkz. lib/friends.js).
const channelSchema = new mongoose.Schema({
  serverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Server",
    default: null,
    required: function () {
      return !this.dmUsers?.length;
    },
  },
  name: { type: String, required: true, trim: true },
  dmUsers: { type: [String], default: undefined, index: true },
  // Eski kısıtlama: platform rolü adları (User.roles). Kanal düzenlenince
  // yerini allowedRoleIds alıyor.
  allowedRoles: { type: [String], default: [] },
  // Sunucuya özel roller: boşsa (ve allowedRoles da boşsa) herkese açık.
  allowedRoleIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // Kategorisi (boşsa listenin en üstündeki kategorisiz kısım) ve o
  // kısımdaki sırası (eşitse oluşturulma sırası; bkz. lib/categories.js).
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelCategory", default: null },
  position: { type: Number, default: 0 },
  // Pistteki disko topunun rengi (#RRGGBB). Boşsa istemci kanal adından
  // üretiyor; kanal ayarından elle seçilebiliyor.
  ballColor: { type: String, default: null, match: /^#[0-9a-fA-F]{6}$/ },
  createdAt: { type: Date, default: Date.now },
});
channelSchema.index({ serverId: 1, name: 1 }, { unique: true });
const Channel = mongoose.models.Channel || mongoose.model("Channel", channelSchema);

// Kanal kategorisi: kanal listesinde başlık, altındaki kanallarla birlikte
// daraltılabiliyor.
const channelCategorySchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true, index: true },
  name: { type: String, required: true, trim: true },
  position: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const ChannelCategory =
  mongoose.models.ChannelCategory || mongoose.model("ChannelCategory", channelCategorySchema);

// Sunucuya özel rol: ad, renk, üye listesinde ayrı gösterme, yetkiler
// (bkz. lib/roles.js). position küçük olan üstte: adın rengi ve üye
// listesindeki başlık en üstteki rolden.
const roleSchema = new mongoose.Schema({
  serverId: { type: mongoose.Schema.Types.ObjectId, ref: "Server", required: true },
  name: { type: String, required: true, trim: true },
  color: { type: String, default: null },
  hoist: { type: Boolean, default: false },
  position: { type: Number, default: 0 },
  permissions: {
    manageChannels: { type: Boolean, default: false },
    manageMessages: { type: Boolean, default: false },
    kickMembers: { type: Boolean, default: false },
    createInvites: { type: Boolean, default: false },
  },
  createdAt: { type: Date, default: Date.now },
});
roleSchema.index({ serverId: 1, name: 1 }, { unique: true });
const Role = mongoose.models.Role || mongoose.model("Role", roleSchema);

// Arkadaşlık: istek (pending) ya da kabul edilmiş (accepted). pair iki
// kişinin sırası önemsiz anahtarı; aynı iki kişi için tek kayıt.
const friendshipSchema = new mongoose.Schema({
  pair: { type: String, required: true, unique: true },
  users: { type: [String], required: true, index: true },
  requester: { type: String, required: true },
  status: { type: String, enum: ["pending", "accepted"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date, default: null },
});
const Friendship = mongoose.models.Friendship || mongoose.model("Friendship", friendshipSchema);

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn(
      "UYARI: MONGODB_URI ortam değişkeni ayarlanmamış — giriş sistemi çalışmayacak."
    );
    return false;
  }
  await mongoose.connect(uri);
  console.log("MongoDB bağlantısı kuruldu.");
  return true;
}

module.exports = {
  connectDB,
  User,
  Message,
  ChannelMember,
  BannedIp,
  Session,
  Server,
  ServerMember,
  ServerBan,
  Channel,
  ChannelCategory,
  Invite,
  Role,
  Friendship,
};
