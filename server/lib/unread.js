// Okunmamışlar: kişinin her kanalda en son ne zaman okuduğu
// (ChannelMember.lastReadAt) ile kanaldaki başkalarının mesajları
// karşılaştırılıyor. Uygulama kapanıp açılsa da kalıyor; eskiden okunmamış
// bilgisi sadece uygulama açıkken bellekte tutuluyordu.
const { Channel, ChannelMember, Message } = require("../db");
const { userCanAccessChannelDoc } = require("./access");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Metinde "@ad" ya da "@all" geçiyor mu (kelimenin tamamı, büyük/küçük harf
// fark etmeden). İstemcideki lib/mentions.jsx ile aynı kural.
function mentionPattern(username) {
  return `(^|\\s)@(all|${escapeRegex(username)})($|[\\s.,!?:;)])`;
}

// Kanal kimliği -> { unread, mentions }. Hiç açılmamış kanalda başkasının
// mesajı varsa okunmamış sayılıyor ama bahsedilmeler sayılmıyor (bütün
// geçmiş taranmasın).
async function unreadByChannel(username, channelIds) {
  const result = new Map();
  if (channelIds.length === 0) return result;
  const members = await ChannelMember.find({ username, channelId: { $in: channelIds } })
    .select("channelId lastReadAt lastSeenAt")
    .lean();
  const since = new Map(members.map((m) => [m.channelId.toString(), m.lastReadAt || m.lastSeenAt || null]));
  await Promise.all(
    channelIds.map(async (channelId) => {
      const key = channelId.toString();
      const readAt = since.get(key);
      const filter = { channelId, username: { $ne: username } };
      if (readAt) filter.createdAt = { $gt: readAt };
      const unread = !!(await Message.exists(filter));
      const mentions =
        unread && readAt
          ? await Message.countDocuments({ ...filter, text: { $regex: mentionPattern(username), $options: "i" } })
          : 0;
      result.set(key, { unread, mentions });
    })
  );
  return result;
}

// Sunucu kimliği -> { unread, mentions }: sunucu şeridindeki işaretler için.
async function unreadByServer(username, roles, servers) {
  const result = new Map();
  if (servers.length === 0) return result;
  const channels = await Channel.find({ serverId: { $in: servers.map((s) => s._id) } }).lean();
  const accessible = channels.filter((c) => userCanAccessChannelDoc(roles, c));
  const byChannel = await unreadByChannel(username, accessible.map((c) => c._id));
  for (const s of servers) result.set(s._id.toString(), { unread: false, mentions: 0 });
  for (const c of accessible) {
    const entry = result.get(c.serverId.toString());
    const channel = byChannel.get(c._id.toString());
    if (!entry || !channel) continue;
    entry.unread = entry.unread || channel.unread;
    entry.mentions += channel.mentions;
  }
  return result;
}

module.exports = { mentionPattern, unreadByChannel, unreadByServer };
