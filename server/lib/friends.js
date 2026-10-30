// Arkadaşlar ve özel mesajlar. Özel mesaj, iki kişilik bir kanal: Channel
// kaydı (serverId boş, dmUsers iki kişi), mesajlar, yanıtlar, tepkiler,
// okunmamışlar ve ses aynı altyapıdan geçiyor.
const { Friendship, Channel, Message, ChannelMember, ServerMember, User } = require("../db");
const { avatarUrlsFor } = require("./avatars");
const { visiblePresence } = require("./presence");
const { socketsByUsername } = require("./state");

// İki kişinin sırası önemsiz anahtarı (ad karakterlerinden bağımsız).
const pairKey = (a, b) => JSON.stringify([a, b].sort());

async function areFriends(a, b) {
  return !!(await Friendship.exists({ pair: pairKey(a, b), status: "accepted" }));
}

async function shareServer(a, b) {
  const mine = await ServerMember.find({ username: a }).distinct("serverId");
  if (mine.length === 0) return false;
  return !!(await ServerMember.exists({ username: b, serverId: { $in: mine } }));
}

// Özel mesaj atılabilir mi: arkadaşlar ya da aynı sunucudakiler.
async function canMessage(a, b) {
  return a !== b && ((await areFriends(a, b)) || (await shareServer(a, b)));
}

async function findOrCreateDm(a, b) {
  const name = pairKey(a, b);
  try {
    return await Channel.findOneAndUpdate(
      { serverId: null, name },
      { $setOnInsert: { serverId: null, name, dmUsers: [a, b].sort() } },
      { upsert: true, new: true }
    ).lean();
  } catch (err) {
    // Aynı anda iki kez açılmaya çalışıldıysa diğeri oluşturmuştur.
    if (err.code === 11000) return Channel.findOne({ serverId: null, name }).lean();
    throw err;
  }
}

// Kişiler için görünen hâl: avatar ve durum (bkz. lib/presence.js).
async function peopleSummaries(usernames) {
  if (usernames.length === 0) return new Map();
  const users = await User.find({ username: { $in: usernames } }).select("username status customStatus").lean();
  const avatarUrls = await avatarUrlsFor(usernames);
  return new Map(
    users.map((u) => [
      u.username,
      { username: u.username, avatarUrl: avatarUrls.get(u.username) || null, ...visiblePresence(u, socketsByUsername.get(u.username)) },
    ])
  );
}

// Arkadaş listesi, gelen ve giden istekler.
async function friendLists(username) {
  const all = await Friendship.find({ users: username }).sort({ createdAt: 1 }).lean();
  const other = (f) => f.users.find((u) => u !== username);
  const people = await peopleSummaries(all.map(other));
  const summary = (f) => people.get(other(f)) || { username: other(f), avatarUrl: null, online: false, status: "offline" };
  return {
    friends: all.filter((f) => f.status === "accepted").map(summary),
    incoming: all.filter((f) => f.status === "pending" && f.requester !== username).map(summary),
    outgoing: all.filter((f) => f.status === "pending" && f.requester === username).map(summary),
  };
}

// Kişinin özel mesajları: karşıdaki, okunmamış sayısı, son mesaj zamanı
// (en yeni üstte).
async function dmList(username) {
  const channels = await Channel.find({ dmUsers: username }).lean();
  const people = await peopleSummaries(channels.map((c) => c.dmUsers.find((u) => u !== username)));
  const reads = await ChannelMember.find({ username, channelId: { $in: channels.map((c) => c._id) } }).lean();
  const readAt = new Map(reads.map((r) => [r.channelId.toString(), r.lastReadAt || r.lastSeenAt || null]));
  const list = await Promise.all(
    channels.map(async (c) => {
      const other = c.dmUsers.find((u) => u !== username);
      const since = readAt.get(c._id.toString());
      const [last, unread] = await Promise.all([
        Message.findOne({ channelId: c._id }).sort({ createdAt: -1 }).select("createdAt").lean(),
        Message.countDocuments({
          channelId: c._id,
          username: { $ne: username },
          ...(since ? { createdAt: { $gt: since } } : {}),
        }).limit(100),
      ]);
      return {
        id: c._id.toString(),
        ...(people.get(other) || { username: other, avatarUrl: null, online: false, status: "offline" }),
        unread,
        lastMessageAt: last?.createdAt || c.createdAt,
      };
    })
  );
  return list.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

// Kişinin bütün açık bağlantılarına bir olay.
function emitToUsers(usernames, event, payload) {
  for (const username of usernames) {
    for (const s of socketsByUsername.get(username) || []) s.emit(event, payload);
  }
}

// Durumu değişen kişinin arkadaşlarına: listelerini yenilesinler (aynı
// sunucuda olmayan arkadaşlar sunucu duyurularını almıyor).
async function announceToFriends(username) {
  try {
    const friendships = await Friendship.find({ users: username, status: "accepted" }).select("users").lean();
    emitToUsers(
      friendships.map((f) => f.users.find((u) => u !== username)),
      "friends-changed",
      {}
    );
  } catch (err) {
    console.error("Arkadaşlara duyurulurken hata:", err.message);
  }
}

module.exports = { pairKey, areFriends, canMessage, findOrCreateDm, friendLists, dmList, emitToUsers, announceToFriends };
