// Mesaj metnindeki @bahsetmelerin vurgulanması.

// YENİ: Mesaj metnindeki @kullanıcıadı bahsetmelerini vurgulu göster.
// Beni (myUsername) bahsedenler ayrıca özel renkte.
export function renderMessageTextWithMentions(text, myUsername) {
  const parts = text.split(/(@[\wÇĞİÖŞÜçğıöşü]+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      // YENİ: "@all" herkese yönelik özel bir etiket — kendi adın gibi
      // vurgulanıyor, çünkü bu mesaj SANA (ve herkese) yönelik.
      const isAll = part.toLowerCase() === '@all'
      const isMe = isAll || (myUsername && part.slice(1).toLowerCase() === myUsername.toLowerCase())
      return (
        <span key={i} className={'mention' + (isMe ? ' mention--me' : '')}>
          {part}
        </span>
      )
    }
    return part
  })
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Metin bu kişiyi ("@ad") ya da herkesi ("@all") bahsediyor mu: kelimenin
// tamamı, büyük/küçük harf fark etmeden ("@mertcan" Mert'i bahsetmiyor).
// Sunucudaki lib/unread.js ile aynı kural.
export function mentionsUser(text, username) {
  if (!text) return false
  const names = ['all', ...(username ? [username] : [])].map((n) => escapeRegex(n.toLocaleLowerCase('tr')))
  return new RegExp(`(^|\\s)@(${names.join('|')})($|[\\s.,!?:;)])`, 'u').test(text.toLocaleLowerCase('tr'))
}
