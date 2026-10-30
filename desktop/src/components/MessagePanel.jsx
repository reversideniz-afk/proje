// Sağdaki mesaj paneli: arama sonuçları ya da kanalın sabitlenmiş mesajları.
// Bir mesaja tıklayınca o mesaja gidiliyor (gerekirse eski mesajlar yükleniyor).
import { Pin, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { formatDayLabel, formatMessageTime } from '../lib/format.js'
import { userColor } from '../lib/userColor.js'

// Aranan kelimeyi metinde vurgula (büyük/küçük harfe bakmadan).
function Highlighted({ text, query }) {
  if (!query) return text
  const lower = text.toLocaleLowerCase('tr')
  const needle = query.toLocaleLowerCase('tr')
  const parts = []
  let from = 0
  for (let at = lower.indexOf(needle); at !== -1 && needle; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  parts.push(text.slice(from))
  return parts
}

export function MessagePanel({
  title,
  messages,
  loading,
  emptyText,
  query,
  avatars,
  nameColors,
  channelNameOf,
  onOpen,
  onUnpin,
  onClose,
}) {
  return (
    <aside className="message-panel" aria-label={title}>
      <div className="message-panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={`${title}: kapat`}>
          <X className="icon" />
        </button>
      </div>
      {loading ? (
        <p className="message-panel-empty">Aranıyor…</p>
      ) : messages.length === 0 ? (
        <p className="message-panel-empty">{emptyText}</p>
      ) : (
        <ul className="message-panel-list">
          {messages.map((m) => (
            <li key={m.id} className="message-panel-item">
              <button type="button" className="message-panel-open" onClick={() => onOpen(m)}>
                <Avatar name={m.username} src={avatars?.get(m.username)} size="sm" />
                <span className="message-panel-body">
                  <span className="message-panel-meta">
                    <strong style={{ color: nameColors?.get(m.username) || userColor(m.username) }}>{m.username}</strong>
                    {channelNameOf && <span>#{channelNameOf(m.channelId)}</span>}
                    <time dateTime={m.createdAt}>
                      {formatDayLabel(m.createdAt)} {formatMessageTime(m.createdAt)}
                    </time>
                  </span>
                  <span className="message-panel-text">
                    <Highlighted text={m.text} query={query} />
                  </span>
                </span>
              </button>
              {onUnpin && (
                <button
                  type="button"
                  className="icon-btn message-panel-unpin"
                  onClick={() => onUnpin(m)}
                  aria-label="Sabitlemeyi kaldır"
                  title="Sabitlemeyi kaldır"
                >
                  <Pin className="icon" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
