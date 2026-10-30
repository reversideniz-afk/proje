// İstemciden gelen verinin doğrulanması ve istemciye gidecek verinin şekli.

// Ses odasındaki bir kişinin istemciden kabul edilen durumu: sadece bu üç
// alan ve sadece true/false.
function pickVoiceState(state) {
  const picked = {};
  for (const key of ["muted", "cameraOn", "sharingScreen"]) {
    if (typeof state?.[key] === "boolean") picked[key] = state[key];
  }
  return picked;
}

// YENİ (güvenlik): "imageData" alanının GERÇEKTEN bir base64 data URI
// olduğunu ve beyan edilen mimeType ile eşleştiğini doğruluyoruz. Bu
// kontrol olmadan biri imageData alanına dışarıdan bir URL (ör.
// "http://saldirgan.com/piksel.png") koyabilir — bunu gören HERKESİN
// istemcisi (<img src=...>) o adrese sessizce bir istek atar, bu da
// görüntüleyen kullanıcıların IP adresini/varlık bilgisini saldırgana
// sızdırır ("takip pikseli"). set-avatar VE send-photo aynı deseni
// kullandığı için ortak fonksiyon.
function isValidImageDataUri(imageData, mimeType) {
  if (typeof imageData !== "string" || typeof mimeType !== "string") return false;
  if (!mimeType.startsWith("image/")) return false;
  const match = imageData.match(
    /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/
  );
  return !!match && match[1] === mimeType;
}

// YENİ: .lean() sorgu sonuçlarını istemciye göndereceğimiz tutarlı
// şekle çeviriyor (_id -> id, string olarak).
function serializeMessage(msg) {
  return {
    id: msg._id.toString(),
    username: msg.username,
    text: msg.text,
    createdAt: msg.createdAt,
    editedAt: msg.editedAt || null,
    reactions: msg.reactions || [],
    replyTo: msg.replyTo
      ? { id: msg.replyTo.messageId?.toString() || null, username: msg.replyTo.username, text: msg.replyTo.text }
      : null,
    pinned: msg.pinnedAt ? { by: msg.pinnedBy, at: msg.pinnedAt } : null,
    poll: msg.poll ? serializePoll(msg.poll) : null,
    event: msg.event ? serializeEvent(msg.event) : null,
  };
}

function serializePoll(poll) {
  return {
    question: poll.question,
    multiple: !!poll.multiple,
    closed: !!poll.closed,
    options: (poll.options || []).map((o) => ({ text: o.text, votes: o.votes || [] })),
  };
}

function serializeEvent(event) {
  return {
    title: event.title,
    startsAt: event.startsAt,
    description: event.description || "",
    going: event.going || [],
    maybe: event.maybe || [],
  };
}

module.exports = { pickVoiceState, isValidImageDataUri, serializeMessage, serializePoll, serializeEvent };
