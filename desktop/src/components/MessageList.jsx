// Sohbetteki mesajlar: gün ayraçları, aynı kişinin 5 dakika içindeki
// mesajlarının gruplanması, avatar ve kişiye özel renk. Tepki, düzenleme,
// kopyalama ve silme mesajın üstünde beliren araç çubuğunda: fareyle
// üstüne gelince, klavyeyle odaklanınca, sağ tıklayınca ve dokunmatikte
// uzun basınca görünüyor (H15; eskiden sadece sağ tıkla açılıyordu).
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, ChartColumn, Check, Copy, CornerUpLeft, Info, Pencil, Pin, PinOff, Reply, SmilePlus, Trash2, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { QUICK_REACTIONS } from '../lib/config.js'
import { formatDayLabel, formatEventTime, formatFullDate, formatMessageTime, formatRelative, isSameDay } from '../lib/format.js'
import { renderMarkdown } from '../lib/markdown.jsx'
import { mentionsUser } from '../lib/mentions.jsx'
import { userColor } from '../lib/userColor.js'
import { useDismiss } from '../lib/useDismiss.js'

const GROUP_WINDOW_MS = 5 * 60 * 1000
const LONG_PRESS_MS = 450

function groupReactions(reactions = []) {
  const byEmoji = new Map()
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, [])
    byEmoji.get(r.emoji).push(r.username)
  }
  return [...byEmoji]
}

function ReactionPicker({ onPick, onClose, placement }) {
  const ref = useRef(null)
  useDismiss(ref, true, onClose)
  // Klavyeyle açılınca da hemen seçilebilsin: odak ilk tepkiye geçiyor,
  // kapanınca menüyü açan düğmeye dönüyor.
  useEffect(() => {
    const opener = document.activeElement
    const picker = ref.current
    picker?.querySelector('button')?.focus()
    return () => {
      if (picker?.contains(document.activeElement) || document.activeElement === document.body) opener?.focus?.()
    }
  }, [])
  return (
    <div ref={ref} className={`popover reaction-picker reaction-picker--${placement}`} role="menu" aria-label="Tepki seç">
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} type="button" role="menuitem" className="reaction-picker-option" onClick={() => onPick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  )
}

function EditBox({ initialText, onSave, onCancel }) {
  const [text, setText] = useState(initialText)
  return (
    <div className="message-edit">
      <textarea
        className="message-edit-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSave(text)
          }
          if (e.key === 'Escape') onCancel()
        }}
        maxLength={2000}
        rows={Math.min(8, text.split('\n').length)}
        aria-label="Mesajı düzenle"
        autoFocus
      />
      <p className="message-edit-hint">
        Kaydetmek için Enter, vazgeçmek için Esc ·{' '}
        <button type="button" className="link-btn" onClick={() => onSave(text)}>
          <Check className="icon" /> Kaydet
        </button>{' '}
        <button type="button" className="link-btn" onClick={onCancel}>
          <X className="icon" /> Vazgeç
        </button>
      </p>
    </div>
  )
}

// Anket: seçeneğe basınca oy (tek seçimlide başka seçeneğe geçer, aynısına
// basınca geri alınır); çubuk oyların payı. Açan kişi bitirebilir.
function PollCard({ item, displayName, canClose, onVote, onClose }) {
  const { poll } = item
  const total = poll.options.reduce((sum, o) => sum + o.votes.length, 0)
  const voters = new Set(poll.options.flatMap((o) => o.votes)).size
  return (
    <div className="plan-card poll-card" role="group" aria-label={`Anket: ${poll.question}`}>
      <p className="plan-card-title">
        <ChartColumn className="icon" aria-hidden="true" />
        {poll.question}
      </p>
      <ul className="poll-options">
        {poll.options.map((option, index) => {
          const mine = option.votes.includes(displayName)
          const share = total ? Math.round((option.votes.length / total) * 100) : 0
          return (
            <li key={index}>
              <button
                type="button"
                className={'poll-option' + (mine ? ' poll-option--mine' : '')}
                aria-pressed={mine}
                disabled={poll.closed}
                onClick={() => onVote(item.id, index)}
                title={option.votes.length ? option.votes.join(', ') : 'Henüz oy yok'}
              >
                <span className="poll-bar" style={{ '--share': `${share}%` }} aria-hidden="true" />
                <span className="poll-option-text">{option.text}</span>
                <span className="poll-option-count">
                  {option.votes.length} · %{share}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="plan-card-foot">
        <span>
          {voters} kişi oy verdi · {poll.multiple ? 'birden fazla seçilebilir' : 'tek seçim'}
          {poll.closed && ' · anket bitti'}
        </span>
        {canClose && !poll.closed && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => onClose(item.id)}>
            Anketi bitir
          </button>
        )}
      </div>
    </div>
  )
}

// Etkinlik: tarih, açıklama, katılıyorum / belki (tekrar basınca geri alınır).
function EventCard({ item, displayName, onRsvp }) {
  const { event } = item
  const start = new Date(event.startsAt)
  const choice = event.going.includes(displayName) ? 'going' : event.maybe.includes(displayName) ? 'maybe' : 'none'
  return (
    <div className="plan-card event-card" role="group" aria-label={`Etkinlik: ${event.title}`}>
      <div className="event-date" aria-hidden="true">
        <span className="event-month">{start.toLocaleDateString('tr-TR', { month: 'short' })}</span>
        <span className="event-day">{start.getDate()}</span>
      </div>
      <div className="event-body">
        <p className="plan-card-title">
          <CalendarDays className="icon" aria-hidden="true" />
          {event.title}
        </p>
        <time className="event-when" dateTime={event.startsAt} title={formatFullDate(event.startsAt)}>
          {formatEventTime(start)} · {formatRelative(start)}
        </time>
        {event.description && <p className="event-description">{event.description}</p>}
        <div className="event-rsvp" role="group" aria-label="Katılım">
          <button
            type="button"
            className="event-rsvp-option"
            aria-pressed={choice === 'going'}
            onClick={() => onRsvp(item.id, choice === 'going' ? 'none' : 'going')}
          >
            Katılıyorum · {event.going.length}
          </button>
          <button
            type="button"
            className="event-rsvp-option"
            aria-pressed={choice === 'maybe'}
            onClick={() => onRsvp(item.id, choice === 'maybe' ? 'none' : 'maybe')}
          >
            Belki · {event.maybe.length}
          </button>
        </div>
        {event.going.length > 0 && <p className="event-people">Geliyor: {event.going.join(', ')}</p>}
      </div>
    </div>
  )
}

// colorOf: kişinin adının rengi (rol rengi, yoksa kişiye özel renk).
function MessageItem({
  item,
  avatarUrl,
  colorOf,
  grouped,
  displayName,
  canModerate,
  isActive,
  pickerOpen,
  pickerPlacement,
  isEditing,
  onActivate,
  onOpenPicker,
  onClosePicker,
  onReact,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onOpenPhoto,
  onReply,
  onJumpTo,
  onTogglePin,
  onVotePoll,
  onClosePoll,
  onRsvpEvent,
}) {
  const pressTimer = useRef(null)
  const isOwn = item.username === displayName
  const isPhoto = item.kind === 'photo'
  const reactions = groupReactions(item.reactions)
  const canDelete = !isPhoto && !!item.id && (isOwn || canModerate)
  // Yanıt verilen kişi de bahsedilmiş sayılıyor.
  const mentionsMe = !isOwn && (mentionsUser(item.text, displayName) || item.replyTo?.username === displayName)

  if (item.system) {
    return (
      <div className="chat-message chat-message--system" role="note">
        <Info className="icon" />
        <span>{item.text}</span>
      </div>
    )
  }

  const startLongPress = (e) => {
    if (e.pointerType !== 'touch') return
    clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(onActivate, LONG_PRESS_MS)
  }
  const cancelLongPress = () => clearTimeout(pressTimer.current)

  return (
    <article
      className={
        'chat-message' +
        (grouped ? ' chat-message--grouped' : '') +
        (isActive || pickerOpen ? ' is-active' : '') +
        (item.replyTo ? ' chat-message--reply' : '') +
        (mentionsMe ? ' chat-message--mention' : '')
      }
      id={item.id ? `mesaj-${item.id}` : undefined}
      onContextMenu={(e) => {
        if (isEditing || isPhoto) return
        e.preventDefault()
        onActivate()
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      {item.replyTo && (
        <button
          type="button"
          className="chat-message-reply-preview"
          onClick={() => onJumpTo(item.replyTo.id)}
          title="Yanıt verilen mesaja git"
        >
          <CornerUpLeft className="icon" aria-hidden="true" />
          <Avatar name={item.replyTo.username} size="xxs" />
          <strong style={{ color: colorOf(item.replyTo.username) }}>{item.replyTo.username}</strong>
          <span className="chat-message-reply-text">{item.replyTo.text}</span>
        </button>
      )}
      {grouped ? (
        <time className="chat-message-gutter-time" dateTime={item.createdAt} title={formatFullDate(item.createdAt)}>
          {formatMessageTime(item.createdAt)}
        </time>
      ) : (
        <Avatar name={item.username} src={avatarUrl} size="md" className="chat-message-avatar" />
      )}

      <div className="chat-message-body">
        {!grouped && (
          <header className="chat-message-head">
            <strong className="chat-message-author" style={{ color: colorOf(item.username) }}>
              {item.username}
            </strong>
            <time className="chat-message-time" dateTime={item.createdAt} title={formatFullDate(item.createdAt)}>
              {formatMessageTime(item.createdAt)}
            </time>
          </header>
        )}

        {isEditing ? (
          <EditBox initialText={item.text} onSave={(text) => onSaveEdit(item.id, text)} onCancel={onCancelEdit} />
        ) : item.poll ? (
          <PollCard
            item={item}
            displayName={displayName}
            canClose={isOwn || canModerate}
            onVote={onVotePoll}
            onClose={onClosePoll}
          />
        ) : item.event ? (
          <EventCard item={item} displayName={displayName} onRsvp={onRsvpEvent} />
        ) : isPhoto ? (
          <div className="chat-photo-wrap">
            <img
              src={item.imageData}
              alt={`${item.username} bir fotoğraf paylaştı`}
              className="chat-photo"
              onClick={() => onOpenPhoto(item.imageData)}
            />
            <span className="chat-photo-hint">Tek seferlik fotoğraf · kaydedilmiyor</span>
          </div>
        ) : (
          <div className="chat-message-text">
            {renderMarkdown(item.text, displayName)}
            {item.editedAt && (
              <span className="chat-message-edited" title={formatFullDate(item.editedAt)}>
                {' '}
                (düzenlendi)
              </span>
            )}
            {item.pinned && (
              <Pin className="icon chat-message-pinned" aria-label={`${item.pinned.by} sabitledi`} role="img" />
            )}
          </div>
        )}

        {reactions.length > 0 && (
          <div className="chat-reactions">
            {reactions.map(([emoji, usernames]) => {
              const mine = usernames.includes(displayName)
              return (
                <button
                  key={emoji}
                  type="button"
                  className={'reaction-pill' + (mine ? ' reaction-pill--mine' : '')}
                  aria-pressed={mine}
                  aria-label={`${emoji} ${usernames.length} kişi: ${usernames.join(', ')}`}
                  title={usernames.join(', ')}
                  onClick={() => onReact(item.id, emoji)}
                >
                  <span aria-hidden="true">{emoji}</span>
                  <span className="reaction-pill-count" aria-hidden="true">
                    {usernames.length}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!isPhoto && item.id && !isEditing && (
        <div className="message-toolbar" role="toolbar" aria-label={`${item.username} mesajı için işlemler`}>
          <button
            type="button"
            className="icon-btn"
            title="Tepki ekle"
            aria-label="Tepki ekle"
            aria-expanded={pickerOpen}
            onClick={(e) => onOpenPicker(e.currentTarget)}
          >
            <SmilePlus className="icon" />
          </button>
          <button type="button" className="icon-btn" title="Yanıtla" aria-label="Yanıtla" onClick={() => onReply(item)}>
            <Reply className="icon" />
          </button>
          {onTogglePin && (
            <button
              type="button"
              className="icon-btn"
              title={item.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
              aria-label={item.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
              onClick={() => onTogglePin(item.id)}
            >
              {item.pinned ? <PinOff className="icon" /> : <Pin className="icon" />}
            </button>
          )}
          {isOwn && !item.poll && !item.event && (
            <button type="button" className="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={onStartEdit}>
              <Pencil className="icon" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Metni kopyala"
            aria-label="Metni kopyala"
            onClick={() => navigator.clipboard?.writeText(item.text)}
          >
            <Copy className="icon" />
          </button>
          {canDelete && (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              title="Sil"
              aria-label="Sil"
              onClick={() => onDelete(item.id)}
            >
              <Trash2 className="icon" />
            </button>
          )}
          {pickerOpen && (
            <ReactionPicker
              placement={pickerPlacement}
              onClose={onClosePicker}
              onPick={(emoji) => {
                onReact(item.id, emoji)
                onClosePicker()
              }}
            />
          )}
        </div>
      )}
    </article>
  )
}

// nameColors: rol rengi olan kişiler -> renk (bkz. lib/roles.js).
export function MessageList({
  items,
  avatars,
  nameColors,
  newSince,
  displayName,
  canModerate,
  onReact,
  onEdit,
  onDelete,
  onOpenPhoto,
  onReply,
  onTogglePin,
  onVotePoll,
  onClosePoll,
  onRsvpEvent,
  containerRef,
}) {
  const colorOf = (name) => nameColors?.get(name) || userColor(name)
  const [activeId, setActiveId] = useState(null)
  const [picker, setPicker] = useState(null) // { id, placement }
  const [editingId, setEditingId] = useState(null)
  const closePicker = useCallback(() => setPicker(null), [])

  // Sağ tıkla ya da uzun basmayla açılan araç çubuğu başka yere dokununca kapanıyor.
  useEffect(() => {
    if (!activeId) return
    const handlePointer = (e) => {
      if (!e.target.closest?.('.chat-message.is-active')) setActiveId(null)
    }
    window.addEventListener('pointerdown', handlePointer)
    return () => window.removeEventListener('pointerdown', handlePointer)
  }, [activeId])

  // Menü normalde aşağı açılıyor; mesaj sohbetin altına yakınsa yukarı
  // (en üstteki mesajda yukarı açılan menü kesiliyordu, H17).
  const openPicker = (id, anchor) => {
    if (picker?.id === id) return setPicker(null)
    const container = containerRef.current?.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const spaceBelow = container ? container.bottom - rect.bottom : Infinity
    setPicker({ id, placement: spaceBelow < 72 ? 'above' : 'below' })
  }

  const keyOf = (item, i) => item.id || `${item.kind}-${item.createdAt}-${i}`

  // Yanıt önizlemesine tıklayınca asıl mesaja kaydır ve kısa süre vurgula
  // (yüklenmiş eski mesajlar arasındaysa).
  const jumpTo = (id) => {
    const target = id && document.getElementById(`mesaj-${id}`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.remove('is-highlighted')
    void target.offsetWidth
    target.classList.add('is-highlighted')
  }

  // "Yeni" çizgisi: kanalı en son okuduğundan sonra başkasının yazdığı ilk
  // mesajın üstünde.
  const firstNewIndex = newSince
    ? items.findIndex(
        (item) =>
          !item.system && item.username !== displayName && new Date(item.createdAt) > new Date(newSince)
      )
    : -1

  return items.map((item, i) => {
    const prev = items[i - 1]
    const newDay = !prev || !isSameDay(prev.createdAt, item.createdAt)
    const isFirstNew = i === firstNewIndex
    const grouped =
      !newDay &&
      !isFirstNew &&
      !item.replyTo &&
      !item.system &&
      !prev.system &&
      prev.username === item.username &&
      new Date(item.createdAt) - new Date(prev.createdAt) < GROUP_WINDOW_MS
    const key = keyOf(item, i)
    return (
      <Fragment key={key}>
        {newDay && (
          <div className="chat-day-divider" role="separator">
            <span>{formatDayLabel(item.createdAt)}</span>
          </div>
        )}
        {isFirstNew && (
          <div className="chat-new-divider" role="separator" aria-label="Yeni mesajlar">
            <span>Yeni</span>
          </div>
        )}
        <MessageItem
          item={item}
          avatarUrl={avatars.get(item.username)}
          colorOf={colorOf}
          onTogglePin={onTogglePin}
          onVotePoll={onVotePoll}
          onClosePoll={onClosePoll}
          onRsvpEvent={onRsvpEvent}
          grouped={grouped}
          displayName={displayName}
          canModerate={canModerate}
          isActive={activeId === key}
          pickerOpen={!!item.id && picker?.id === item.id}
          pickerPlacement={picker?.placement}
          isEditing={!!item.id && editingId === item.id}
          onActivate={() => setActiveId((current) => (current === key ? null : key))}
          onOpenPicker={(anchor) => openPicker(item.id, anchor)}
          onClosePicker={closePicker}
          onReact={onReact}
          onStartEdit={() => {
            setEditingId(item.id)
            setPicker(null)
          }}
          onSaveEdit={(id, text) => {
            setEditingId(null)
            if (text.trim() && text.trim() !== item.text) onEdit(id, text.trim())
          }}
          onCancelEdit={() => setEditingId(null)}
          onDelete={(id) => {
            setActiveId(null)
            onDelete(id)
          }}
          onOpenPhoto={onOpenPhoto}
          onReply={onReply}
          onJumpTo={jumpTo}
        />
      </Fragment>
    )
  })
}
