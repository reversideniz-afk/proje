// Mesaj biçimlendirme: kod bloğu (```), alıntı (> ), satır içi kod (`),
// kalın (**), italik (* ya da _), üstü çizili (~~), spoiler (||), linkler ve
// @bahsetmeler. HTML üretmiyor: her parça React öğesi, metin her zaman
// kaçışlı kalıyor (mesaja yazılan HTML düz metin olarak görünüyor).
import { Spoiler } from '../components/Spoiler.jsx'

// Aynı yerde birden çok kalıp başlıyorsa listede önce olan kazanıyor
// (kod ve linkin içi biçimlendirilmiyor).
const INLINE = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'link', re: /https?:\/\/[^\s<>"]*[^\s<>".,:;'!?)\]]/ },
  { type: 'spoiler', re: /\|\|([^\n]+?)\|\|/ },
  { type: 'bold', re: /\*\*([^\n]+?)\*\*/ },
  { type: 'strike', re: /~~([^\n]+?)~~/ },
  { type: 'italic', re: /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/u },
  { type: 'mention', re: /@[\p{L}\p{N}_]+/u },
]

function renderInline(text, myName, keyPrefix) {
  const out = []
  let rest = text
  let index = 0
  while (rest) {
    let best = null
    for (const pattern of INLINE) {
      const match = pattern.re.exec(rest)
      if (match && (!best || match.index < best.match.index)) best = { pattern, match }
    }
    if (!best) {
      out.push(rest)
      break
    }
    const { pattern, match } = best
    if (match.index > 0) out.push(rest.slice(0, match.index))
    const key = `${keyPrefix}-${index++}`
    const inner = match[1] ?? match[2]
    switch (pattern.type) {
      case 'code':
        out.push(
          <code key={key} className="md-code">
            {inner}
          </code>
        )
        break
      case 'link':
        out.push(
          <a key={key} className="md-link" href={match[0]} target="_blank" rel="noopener noreferrer">
            {match[0]}
          </a>
        )
        break
      case 'spoiler':
        out.push(<Spoiler key={key}>{renderInline(inner, myName, key)}</Spoiler>)
        break
      case 'bold':
        out.push(<strong key={key}>{renderInline(inner, myName, key)}</strong>)
        break
      case 'strike':
        out.push(<del key={key}>{renderInline(inner, myName, key)}</del>)
        break
      case 'italic':
        out.push(<em key={key}>{renderInline(inner, myName, key)}</em>)
        break
      case 'mention': {
        const name = match[0].slice(1).toLocaleLowerCase('tr')
        const isMe = name === 'all' || (!!myName && name === myName.toLocaleLowerCase('tr'))
        out.push(
          <span key={key} className={'mention' + (isMe ? ' mention--me' : '')}>
            {match[0]}
          </span>
        )
        break
      }
    }
    rest = rest.slice(match.index + match[0].length)
  }
  return out
}

// Kod blokları dışındaki metin: "> " ile başlayan ardışık satırlar alıntı.
function renderLines(text, myName, keyPrefix) {
  const out = []
  const lines = text.split('\n')
  let i = 0
  let plain = []
  const flushPlain = () => {
    if (plain.length === 0) return
    out.push(...renderInline(plain.join('\n'), myName, `${keyPrefix}-p${out.length}`))
    plain = []
  }
  while (i < lines.length) {
    if (/^> /.test(lines[i])) {
      flushPlain()
      const quoted = []
      while (i < lines.length && /^> /.test(lines[i])) quoted.push(lines[i++].slice(2))
      out.push(
        <blockquote key={`${keyPrefix}-q${out.length}`} className="md-quote">
          {renderInline(quoted.join('\n'), myName, `${keyPrefix}-q${out.length}`)}
        </blockquote>
      )
    } else {
      // Satır sonlarını koru (metin pre-wrap ile gösteriliyor).
      plain.push(lines[i++])
    }
  }
  flushPlain()
  return out
}

export function renderMarkdown(text, myName) {
  const out = []
  const blockRe = /```(?:[\w+-]*\n)?([\s\S]*?)```/g
  let last = 0
  let match
  while ((match = blockRe.exec(text))) {
    // Bloğun hemen önündeki ve arkasındaki satır sonu blokla birlikte gidiyor
    // (blok zaten kendi satırında duruyor).
    const before = text.slice(last, match.index).replace(/\n$/, '')
    if (before) out.push(...renderLines(before, myName, `t${last}`))
    out.push(
      <pre key={`b${match.index}`} className="md-codeblock">
        <code>{match[1].replace(/\n$/, '')}</code>
      </pre>
    )
    last = match.index + match[0].length
    if (text[last] === '\n') last++
  }
  if (last < text.length) out.push(...renderLines(text.slice(last), myName, `t${last}`))
  return out
}
