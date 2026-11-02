// Küçük pencereler ve açılır kutular: sunucu oluştur/katıl, davet kodu,
// kanal oluştur, onay, güvenlik uyarısı, kişi ses seviyesi, ekran seçimi,
// fotoğraf büyütme.
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, MessageSquare, Monitor, Plus, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { Dialog } from './Dialog.jsx'
import { Toggle } from './Toggle.jsx'
import { serverInitials } from '../lib/format.js'
import { CUSTOM_STATUS_DURATIONS } from '../lib/presence.js'
import { PERMISSIONS, ROLE_COLORS } from '../lib/roles.js'
import { describeInvite, inviteLink } from '../lib/invites.js'
import { CONTENT_TYPES, FRAME_RATES, RESOLUTIONS, formatBitrate, screenBitrate } from '../lib/screenShare.js'
import { useDismiss } from '../lib/useDismiss.js'
import './Dialogs.css'

export function ServerDialog({ initialTab, hasOwnServer, busy, error, onCreate, onJoin, onClose }) {
  const [tab, setTab] = useState(initialTab)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  return (
    <Dialog title="Sunucu oluştur ya da katıl" onClose={onClose}>
      <div className="segmented" role="tablist" aria-label="Ne yapmak istiyorsun?">
        <button type="button" role="tab" aria-selected={tab === 'create'} className="segmented-option" onClick={() => setTab('create')}>
          Oluştur
        </button>
        <button type="button" role="tab" aria-selected={tab === 'join'} className="segmented-option" onClick={() => setTab('join')}>
          Katıl
        </button>
      </div>
      {tab === 'create' ? (
        hasOwnServer ? (
          <p className="field-hint">Zaten bir sunucun var. Kişi başı bir sunucu açılabiliyor.</p>
        ) : (
          <form
            className="dialog-body"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) onCreate(name.trim())
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="new-server-name">
                Sunucu adı
              </label>
              <input id="new-server-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus />
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="dialog-actions">
              <button type="submit" className="btn" disabled={busy || !name.trim()}>
                Sunucu oluştur
              </button>
            </div>
          </form>
        )
      ) : (
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) onJoin(code.trim())
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="join-server-code">
              Davet kodu
            </label>
            <input id="join-server-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="submit" className="btn" disabled={busy || !code.trim()}>
              Sunucuya katıl
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

const EXPIRY_OPTIONS = [
  { hours: 168, label: '7 gün' },
  { hours: 24, label: '1 gün' },
  { hours: 1, label: '1 saat' },
  { hours: null, label: 'Hiç dolmasın' },
]
const USE_OPTIONS = [0, 1, 5, 10, 25]

// Sahip için davet: açılınca sunucunun kalıcı bağlantısı; süreli ya da
// kullanım sayısı sınırlı yeni bağlantı oluşturulabiliyor.
export function InviteDialog({ serverName, permanentCode, onCreate, onClose }) {
  const [invite, setInvite] = useState(null) // oluşturulan son davet
  const [expiresInHours, setExpiresInHours] = useState(168)
  const [maxUses, setMaxUses] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const link = inviteLink(invite ? invite.code : permanentCode)

  const create = async () => {
    setBusy(true)
    setError(null)
    const response = await onCreate({ expiresInHours, maxUses })
    setBusy(false)
    if (response?.success) {
      setInvite(response.invite)
      setCopied(false)
    } else {
      setError(response?.message || 'Davet oluşturulamadı.')
    }
  }

  return (
    <Dialog title={`${serverName} daveti`} onClose={onClose}>
      <div className="dialog-body">
        <p className="field-hint">
          Bağlantıyı arkadaşına gönder: açınca Disco'da sunucuya katılma penceresi çıkıyor. Kod olarak da
          kullanılabiliyor (Sunucu oluştur ya da katıl &gt; Katıl).
        </p>
        <div className="invite-code-row">
          <input className="input invite-code" value={link} readOnly onFocus={(e) => e.target.select()} aria-label="Davet bağlantısı" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(link)
              setCopied(true)
            }}
          >
            {copied ? <Check className="icon" /> : <Copy className="icon" />}
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
        </div>
        <p className="field-hint invite-status" role="status">
          {invite ? describeInvite(invite) : 'Kalıcı bağlantı: süresi dolmuyor, kullanım sınırı yok.'}
        </p>
        <div className="invite-options">
          <div className="field">
            <label className="field-label" htmlFor="invite-expiry">
              Süre
            </label>
            <select
              id="invite-expiry"
              className="select"
              value={String(expiresInHours)}
              onChange={(e) => setExpiresInHours(e.target.value === 'null' ? null : Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={String(o.hours)} value={String(o.hours)}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="invite-uses">
              Kullanım
            </label>
            <select id="invite-uses" className="select" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
              {USE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Sınırsız' : `${n} kişi`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={create} disabled={busy}>
            Yeni bağlantı oluştur
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// Davet bağlantısıyla gelen kişiye: hangi sunucu, kaç üye; katıl ya da
// zaten üyeyse sunucuya git.
export function JoinInviteDialog({ code, info, isMember, busy, error, onJoin, onGoTo, onClose }) {
  const server = info?.success ? info.server : null
  return (
    <Dialog title="Sunucu daveti" onClose={onClose}>
      <div className="dialog-body">
        {!info && <p className="field-hint">Davet kontrol ediliyor…</p>}
        {info && !server && (
          <p className="form-error" role="alert">
            {info.message || 'Davet bağlantısı geçersiz.'}
          </p>
        )}
        {server && (
          <div className="invite-server">
            <span className="invite-server-icon" aria-hidden="true">
              {serverInitials(server.name)}
            </span>
            <span>
              <strong className="invite-server-name">{server.name}</strong>
              <span className="field-hint">{server.memberCount} üye</span>
            </span>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {!window.electronAPI && server && (
            <a className="btn btn--ghost" href={`disco://davet/${code}`}>
              Masaüstü uygulamasında aç
            </a>
          )}
          {server && isMember && (
            <button type="button" className="btn" onClick={onGoTo}>
              Sunucuya git
            </button>
          )}
          {server && !isMember && (
            <button type="button" className="btn" onClick={onJoin} disabled={busy}>
              {busy ? 'Katılınıyor…' : 'Sunucuya katıl'}
            </button>
          )}
          {!server && info && (
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Tamam
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

export function CreateChannelDialog({ error, busy, onCreate, onClose }) {
  const [name, setName] = useState('')
  return (
    <Dialog title="Kanal oluştur" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name.trim())
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="new-channel-name">
            Kanal adı
          </label>
          <input
            id="new-channel-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. oyun-gecesi"
            maxLength={50}
            autoFocus
          />
        </div>
        <p className="field-hint">Her kanalın hem sohbeti hem sesi var.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            Kanal oluştur
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Kanal kategorisi: category null ise yeni kategori. Silinen kategorinin
// kanalları silinmiyor, listenin üstündeki kategorisiz kısma geçiyor.
export function CategoryDialog({ category, busy, error, onSave, onDelete, onClose }) {
  const [name, setName] = useState(category?.name || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <Dialog title={category ? `${category.name} kategorisi` : 'Kategori oluştur'} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onSave(name.trim())
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="category-name">
            Kategori adı
          </label>
          <input
            id="category-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Oyunlar"
            maxLength={50}
            autoFocus
          />
        </div>
        {category && <p className="field-hint">Kategoriyi silince kanalları silinmez, listenin en üstüne geçer.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {category &&
            (confirmDelete ? (
              <button type="button" className="btn btn--danger dialog-actions-start" onClick={onDelete} disabled={busy}>
                Silmeyi onayla
              </button>
            ) : (
              <button type="button" className="btn btn--ghost dialog-actions-start" onClick={() => setConfirmDelete(true)}>
                Kategoriyi sil
              </button>
            ))}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {category ? 'Kaydet' : 'Kategori oluştur'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-body">
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export function SecurityAlertDialog({ alert, onClose }) {
  return (
    <Dialog
      title={
        <>
          <ShieldAlert className="icon dialog-title-icon" /> Güvenlik uyarısı
        </>
      }
      onClose={onClose}
    >
      <div className="dialog-body">
        <p className="dialog-message">
          <strong className="settings-mono">{alert.ip}</strong> adresi kalıcı olarak banlandı.
        </p>
        <p className="field-hint">
          Sebep: {alert.reason} ({alert.attemptCount} deneme). Bunu bir arkadaşın yanlışlıkla yaptıysa banı
          Ayarlar &gt; Yönetim &gt; Güvenlik&apos;ten kaldırabilirsin.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Tamam
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// Bir kişinin ses seviyesi (%0-200). Sağ tıkla ya da kişinin üzerindeki
// düğmeyle açılıyor; tıklanan yerin yanında beliriyor.
// Bir kişinin ses seviyesi; onMessage verilirse ona özel mesaj düğmesi.
export function VolumePopover({ username, x, y, volume, onChange, onMessage, onClose }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useDismiss(ref, true, onClose)

  // Pencerenin dışına taşmasın.
  useEffect(() => {
    const rect = ref.current.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  return (
    <div ref={ref} className="popover volume-popup" style={position} role="dialog" aria-label={`${username} ses seviyesi`}>
      <div className="volume-popup-head">
        <strong>{username}</strong>
        <span className="volume-popup-value">{volume}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="200"
        step="5"
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${username} ses seviyesi`}
        autoFocus
      />
      <div className="volume-popup-actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onChange(100)} disabled={volume === 100}>
          <RotateCcw className="icon" />
          Sıfırla
        </button>
        {onMessage && (
          <button type="button" className="btn btn--secondary btn--small" onClick={onMessage}>
            <MessageSquare className="icon" />
            Mesaj gönder
          </button>
        )}
      </div>
    </div>
  )
}

function ChoiceGroup({ label, options, value, onChange }) {
  const labelId = useId()
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="segmented segmented--choice" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className="segmented-option"
            title={option.hint}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Ekran paylaşımı kalitesi (paylaşma penceresinde ve ayarlarda aynı).
// viewerCount: sesteki diğer kişiler; görüntü her birine ayrı gidiyor.
export function ScreenQualityFields({ quality, onChange, viewerCount = 0 }) {
  const perViewer = screenBitrate(quality)
  return (
    <div className="screen-quality">
      <ChoiceGroup
        label="Çözünürlük"
        options={RESOLUTIONS.map((r) => ({ value: r.id, label: r.label }))}
        value={quality.resolution}
        onChange={(resolution) => onChange({ resolution })}
      />
      <ChoiceGroup
        label="Kare hızı"
        options={FRAME_RATES.map((fps) => ({ value: fps, label: `${fps} FPS` }))}
        value={quality.frameRate}
        onChange={(frameRate) => onChange({ frameRate })}
      />
      <ChoiceGroup
        label="İçerik"
        options={CONTENT_TYPES.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))}
        value={quality.content}
        onChange={(content) => onChange({ content })}
      />
      <p className="field-hint" role="status">
        {CONTENT_TYPES.find((c) => c.id === quality.content)?.hint}. Kişi başı en fazla {formatBitrate(perViewer)}
        {viewerCount > 1
          ? `; sesteki ${viewerCount} kişiye ayrı gider, toplam ${formatBitrate(perViewer * viewerCount)} yükleme.`
          : '; sesteki herkese ayrı gider. Yükleme hızın yetmezse görüntü kendiliğinden düşer.'}
      </p>
    </div>
  )
}

// Ekran paylaşımını başlatma penceresi. Masaüstünde (sources) paylaşılacak
// ekran ya da pencere burada seçiliyor; web'de tarayıcının kendi seçicisi
// "Ekranı seç" ile açılıyor.
export function ScreenShareDialog({ sources, quality, onQualityChange, viewerCount, onStart, onCancel }) {
  const [selected, setSelected] = useState(null)
  return (
    <Dialog title="Ekranını paylaş" onClose={onCancel} className={sources ? 'dialog--wide' : ''} closeLabel="Vazgeç">
      <div className="dialog-body">
        {sources && (
          <div className="screen-picker-grid" role="group" aria-label="Paylaşılacak ekran ya da pencere">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="screen-picker-item"
                aria-pressed={selected === source.id}
                onClick={() => setSelected(source.id)}
                onDoubleClick={() => onStart(source.id)}
              >
                <img src={source.thumbnailDataUrl} alt="" />
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        )}
        <ScreenQualityFields quality={quality} onChange={onQualityChange} viewerCount={viewerCount} />
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="button" className="btn" disabled={sources && !selected} onClick={() => onStart(selected)}>
            <Monitor className="icon" />
            {sources ? 'Paylaş' : 'Ekranı seç ve paylaş'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export function PhotoLightbox({ src, onClose }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])
  return (
    <div className="photo-lightbox" role="dialog" aria-label="Fotoğraf" onClick={onClose}>
      <img src={src} alt="Paylaşılan fotoğraf" />
    </div>
  )
}

// Anket oluşturma: soru, 2-6 seçenek, birden fazla seçilebilsin mi.
export function PollDialog({ busy, error, onCreate, onClose }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const filled = options.map((o) => o.trim()).filter(Boolean)
  return (
    <Dialog title="Anket oluştur" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate({ question: question.trim(), options: filled, multiple })
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="poll-question">
            Soru
          </label>
          <input
            id="poll-question"
            className="input"
            maxLength={200}
            placeholder="Ör. Cumartesi ne oynayalım?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">Seçenekler</span>
          {options.map((option, index) => (
            <div key={index} className="poll-dialog-option">
              <input
                className="input"
                maxLength={80}
                aria-label={`Seçenek ${index + 1}`}
                value={option}
                onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Seçenek ${index + 1}: kaldır`}
                >
                  <X className="icon" />
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button type="button" className="btn btn--ghost btn--small poll-dialog-add" onClick={() => setOptions((prev) => [...prev, ''])}>
              <Plus className="icon" />
              Seçenek ekle
            </button>
          )}
        </div>
        <Toggle label="Birden fazla seçilebilsin" checked={multiple} onChange={setMultiple} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !question.trim() || filled.length < 2}>
            Anketi gönder
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Etkinlik planlama: başlık, tarih ve saat, açıklama.
export function EventDialog({ busy, error, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [description, setDescription] = useState('')
  return (
    <Dialog title="Etkinlik planla" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate({ title: title.trim(), startsAt: new Date(when).toISOString(), description: description.trim() })
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="event-title">
            Ne yapılacak
          </label>
          <input
            id="event-title"
            className="input"
            maxLength={100}
            placeholder="Ör. Valorant turnuvası"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="event-when">
            Ne zaman
          </label>
          <input id="event-when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="event-description">
            Açıklama (isteğe bağlı)
          </label>
          <textarea
            id="event-description"
            className="input"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <p className="field-hint">Katılıyorum ya da belki diyenlere başlarken hatırlatma gider.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !title.trim() || !when}>
            Etkinliği paylaş
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Özel durum: adının altında görünen kısa yazı ve ne zaman silineceği.
export function CustomStatusDialog({ current, busy, error, onSave, onClose }) {
  const [text, setText] = useState(current || '')
  const [hours, setHours] = useState(4)
  return (
    <Dialog title="Özel durum" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ text: text.trim(), expiresInHours: hours })
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="custom-status-text">
            Ne yapıyorsun?
          </label>
          <input
            id="custom-status-text"
            className="input"
            maxLength={80}
            placeholder="Ör. yarın sınav var, akşam gelirim"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="custom-status-expiry">
            Silinsin
          </label>
          <select
            id="custom-status-expiry"
            className="select"
            value={String(hours)}
            onChange={(e) => setHours(e.target.value === 'null' ? null : Number(e.target.value))}
          >
            {CUSTOM_STATUS_DURATIONS.map((d) => (
              <option key={String(d.hours)} value={String(d.hours)}>
                {d.hours ? `${d.label} sonra` : d.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !text.trim()}>
            Kaydet
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Sunucu rolü oluşturma ya da düzenleme (sadece sunucu sahibi).
export function RoleDialog({ role, busy, error, onSave, onDelete, onClose }) {
  const [name, setName] = useState(role?.name || '')
  const [color, setColor] = useState(role ? role.color : ROLE_COLORS[5])
  const [hoist, setHoist] = useState(role?.hoist ?? false)
  const [permissions, setPermissions] = useState(role?.permissions || {})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const colorLabelId = useId()
  return (
    <Dialog title={role ? `“${role.name}” rolü` : 'Yeni rol'} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ name: name.trim(), color, hoist, permissions })
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="role-name">
            Rol adı
          </label>
          <input id="role-name" className="input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <span className="field-label" id={colorLabelId}>
            Renk
          </span>
          <div className="role-colors" role="radiogroup" aria-labelledby={colorLabelId}>
            {[null, ...ROLE_COLORS].map((c) => (
              <button
                key={c || 'yok'}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c ? `Renk ${c}` : 'Renksiz'}
                title={c ? undefined : 'Renksiz: adı kişinin kendi renginde görünür'}
                className={'role-color' + (c ? '' : ' role-color--none')}
                style={c ? { '--swatch': c } : undefined}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <Toggle
          label="Üye listesinde ayrı göster"
          hint="Bu roldekiler çevrimiçi listesinde kendi başlıkları altında görünür."
          checked={hoist}
          onChange={setHoist}
        />
        <div className="field">
          <span className="field-label">Yetkiler</span>
          {PERMISSIONS.map((p) => (
            <Toggle
              key={p.id}
              label={p.label}
              hint={p.hint}
              checked={!!permissions[p.id]}
              onChange={(on) => setPermissions((prev) => ({ ...prev, [p.id]: on }))}
            />
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {role &&
            (confirmDelete ? (
              <button type="button" className="btn btn--danger dialog-actions-start" onClick={onDelete} disabled={busy}>
                Silmeyi onayla
              </button>
            ) : (
              <button type="button" className="btn btn--ghost dialog-actions-start" onClick={() => setConfirmDelete(true)}>
                Rolü sil
              </button>
            ))}
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {role ? 'Kaydet' : 'Rolü oluştur'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Kanalı düzenleme: ad, kimlerin görebileceği, silme (Kanalları yönet).
// Sunucu sahibi kısıtlı kanalları da her zaman görüyor.
export function EditChannelDialog({ channel, roles, categories = [], busy, error, onSave, onDelete, onClose }) {
  const [name, setName] = useState(channel.name)
  const [categoryId, setCategoryId] = useState(channel.categoryId || '')
  const [restricted, setRestricted] = useState((channel.allowedRoleIds || []).length > 0)
  const [roleIds, setRoleIds] = useState(channel.allowedRoleIds || [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const accessLabelId = useId()
  const toggleRole = (id) => setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  return (
    <Dialog title={`#${channel.name} kanalı`} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ name: name.trim(), allowedRoleIds: restricted ? roleIds : [], categoryId: categoryId || null })
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="channel-edit-name">
            Kanal adı
          </label>
          <input id="channel-edit-name" className="input" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {categories.length > 0 && (
          <div className="field">
            <label className="field-label" htmlFor="channel-edit-category">
              Kategori
            </label>
            <select id="channel-edit-category" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Kategorisiz</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <span className="field-label" id={accessLabelId}>
            Kimler görebilir
          </span>
          <div className="segmented segmented--choice" role="radiogroup" aria-labelledby={accessLabelId}>
            <button type="button" role="radio" aria-checked={!restricted} className="segmented-option" onClick={() => setRestricted(false)}>
              Herkes
            </button>
            <button type="button" role="radio" aria-checked={restricted} className="segmented-option" onClick={() => setRestricted(true)}>
              Seçtiğim roller
            </button>
          </div>
          {restricted &&
            (roles.length === 0 ? (
              <p className="field-hint">Henüz rol yok. Ayarlar &gt; Roller'den oluşturabilirsin.</p>
            ) : (
              <div className="role-checks" role="group" aria-label="Kanalı görebilecek roller">
                {roles.map((role) => (
                  <label key={role.id} className="role-check">
                    <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
                    <span className="role-dot" style={{ '--swatch': role.color || 'var(--soluk)' }} aria-hidden="true" />
                    {role.name}
                  </label>
                ))}
              </div>
            ))}
          {channel.legacyRoles?.length > 0 && (
            <p className="field-hint">
              Eski kısıtlama: {channel.legacyRoles.join(', ')}. Kaydedince yerini buradaki ayar alır.
            </p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {confirmDelete ? (
            <button type="button" className="btn btn--danger dialog-actions-start" onClick={onDelete} disabled={busy}>
              Silmeyi onayla
            </button>
          ) : (
            <button type="button" className="btn btn--ghost dialog-actions-start" onClick={() => setConfirmDelete(true)}>
              Kanalı sil
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={busy || !name.trim() || (restricted && roleIds.length === 0)}>
            Kaydet
          </button>
        </div>
      </form>
    </Dialog>
  )
}
