// Mesaj yazma alanı: çok satırlı (Enter gönderir, Shift+Enter yeni satır),
// fotoğraf ekleme ve yapıştırma, emoji, @ ile etiketleme önerisi. Öneri Türkçe
// harfli isimlerde de çalışıyor ve imlecin olduğu yerdeki kelimeye bakıyor
// (H22; eskiden sadece metnin sonunda ve İngilizce harflerle çalışıyordu).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, SendHorizontal, Smile, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { COMPOSER_EMOJIS } from '../lib/config.js'
import { toDative } from '../lib/format.js'
import { useDismiss } from '../lib/useDismiss.js'

const MENTION_PATTERN = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const MAX_SUGGESTIONS = 8

function lower(text) {
  return text.toLocaleLowerCase('tr')
}

function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null)
  useDismiss(ref, true, onClose)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
  }, [])
  return (
    <div ref={ref} className="popover emoji-picker" role="menu" aria-label="Emoji ekle">
      {COMPOSER_EMOJIS.map((emoji) => (
        <button key={emoji} type="button" role="menuitem" className="emoji-picker-option" onClick={() => onPick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  )
}

// replyingTo: yanıt verilen mesaj (varsa üstte çubuk çıkıyor, Esc vazgeçiyor).
// isDm: özel mesaj ("Ece'ye yaz"), değilse kanal ("#genel kanalına yaz").
export function Composer({
  channelName,
  isDm = false,
  members,
  displayName,
  onSend,
  onTyping,
  onPhotoFile,
  isSendingPhoto,
  replyingTo,
  onCancelReply,
}) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(0)
  const [dismissedAt, setDismissedAt] = useState(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const closeEmoji = useCallback(() => setEmojiOpen(false), [])
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const listId = useId()

  const beforeCaret = text.slice(0, caret)
  const mentionMatch = beforeCaret.match(MENTION_PATTERN)
  const query = mentionMatch && dismissedAt !== caret ? lower(mentionMatch[2]) : null
  const suggestions =
    query === null
      ? []
      : [
          { username: 'all', label: 'herkese haber ver', isAll: true },
          ...members
            .filter((m) => m.username !== displayName)
            .map((m) => ({ ...m, label: m.online ? 'çevrimiçi' : 'çevrimdışı' })),
        ]
          .filter((c) => lower(c.username).startsWith(query))
          .slice(0, MAX_SUGGESTIONS)
  const open = suggestions.length > 0
  const active = open ? Math.min(highlight, suggestions.length - 1) : -1

  // Yazdıkça büyüyen alan (en fazla ekranın üçte biri).
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`
  }, [text])

  // Kanal değişince ve yanıt başlayınca yazı alanına odaklan.
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })
  }, [channelName, replyingTo?.id])

  const updateCaret = () => setCaret(textareaRef.current?.selectionStart ?? text.length)

  const insertMention = (username) => {
    const start = beforeCaret.length - mentionMatch[2].length - 1
    const next = `${text.slice(0, start)}@${username} ${text.slice(caret)}`
    const nextCaret = start + username.length + 2
    setText(next)
    setCaret(nextCaret)
    setHighlight(0)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  // Emoji imlecin olduğu yere ekleniyor. Konumu yazı alanının kendisinden
  // okuyoruz: odak emoji düğmesine geçse de textarea imleci hatırlıyor.
  const insertEmoji = (emoji) => {
    const at = textareaRef.current?.selectionStart ?? caret
    const next = text.slice(0, at) + emoji + text.slice(at)
    const nextCaret = at + emoji.length
    setText(next)
    setCaret(nextCaret)
    setEmojiOpen(false)
    onTyping()
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    setCaret(0)
  }

  const handleKeyDown = (e) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setHighlight((active + step + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(suggestions[active].username)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedAt(caret)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault()
      onCancelReply()
    }
  }

  const handlePaste = (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) onPhotoFile(file)
        return
      }
    }
  }

  return (
    <form
      className={'composer' + (replyingTo ? ' composer--replying' : '')}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {replyingTo && (
        <div className="composer-reply">
          <span>
            Yanıt veriyorsun: <strong>{replyingTo.username}</strong>
          </span>
          <button
            type="button"
            className="icon-btn icon-btn--small"
            onClick={onCancelReply}
            aria-label="Yanıtı iptal et"
            title="Yanıtı iptal et (Esc)"
          >
            <X className="icon" />
          </button>
        </div>
      )}
      {open && (
        <ul id={listId} className="popover mention-suggestions" role="listbox" aria-label="Etiketlenecek kişi">
          {suggestions.map((s, i) => (
            <li
              key={s.username}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={'mention-suggestion' + (i === active ? ' mention-suggestion--active' : '')}
              onMouseDown={(e) => {
                e.preventDefault() // yazı alanı odağı kaybetmesin
                insertMention(s.username)
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {s.isAll ? (
                <span className="mention-suggestion-all" aria-hidden="true">
                  @
                </span>
              ) : (
                <Avatar name={s.username} src={s.avatarUrl} size="xs" />
              )}
              <strong>@{s.username}</strong>
              <span className="mention-suggestion-hint">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // aynı dosya üst üste seçilebilsin
          if (file) onPhotoFile(file)
        }}
      />
      <button
        type="button"
        className="icon-btn composer-attach"
        onClick={() => fileInputRef.current?.click()}
        disabled={isSendingPhoto}
        aria-label="Fotoğraf paylaş"
        title="Fotoğraf paylaş (kaydedilmez, sadece o an kanaldakiler görür)"
      >
        {isSendingPhoto ? <LoaderCircle className="icon composer-spinner" /> : <ImagePlus className="icon" />}
      </button>
      <textarea
        ref={textareaRef}
        className="composer-input"
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          setHighlight(0)
          setDismissedAt(null)
          if (e.target.value) onTyping()
        }}
        onSelect={updateCaret}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={isDm ? `${toDative(channelName)} yaz` : `#${channelName} kanalına yaz`}
        aria-label="Mesaj yaz"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        maxLength={2000}
      />
      <button
        type="button"
        className="icon-btn"
        onClick={() => setEmojiOpen((open) => !open)}
        aria-label="Emoji ekle"
        aria-expanded={emojiOpen}
        title="Emoji ekle"
      >
        <Smile className="icon" />
      </button>
      {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={closeEmoji} />}
      <button type="submit" className="icon-btn composer-send" aria-label="Gönder" title="Gönder (Enter)" disabled={!text.trim()}>
        <SendHorizontal className="icon" />
      </button>
    </form>
  )
}
