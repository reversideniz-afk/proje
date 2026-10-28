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
