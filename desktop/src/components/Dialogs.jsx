// Küçük pencereler ve açılır kutular: sunucu oluştur/katıl, davet kodu,
// kanal oluştur, onay, güvenlik uyarısı, kişi ses seviyesi, ekran seçimi,
// fotoğraf büyütme.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RotateCcw, ShieldAlert } from 'lucide-react'
import { Dialog } from './Dialog.jsx'
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

export function InviteDialog({ serverName, code, onClose }) {
  const [copied, setCopied] = useState(false)
  return (
    <Dialog title={`${serverName} daveti`} onClose={onClose}>
      <div className="dialog-body">
        <p className="field-hint">
          Bu kodu arkadaşına gönder. Sunucu oluştur ya da katıl &gt; Katıl&apos;a yazarak sunucuya girebilir.
        </p>
        <div className="invite-code-row">
          <input className="input invite-code" value={code} readOnly onFocus={(e) => e.target.select()} aria-label="Davet kodu" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(code)
              setCopied(true)
            }}
          >
            {copied ? <Check className="icon" /> : <Copy className="icon" />}
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
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
export function VolumePopover({ username, x, y, volume, onChange, onClose }) {
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
      <button type="button" className="btn btn--ghost btn--small" onClick={() => onChange(100)} disabled={volume === 100}>
        <RotateCcw className="icon" />
        Sıfırla
      </button>
    </div>
  )
}

export function ScreenPicker({ sources, onSelect, onCancel }) {
  return (
    <Dialog title="Neyi paylaşmak istersin?" onClose={onCancel} className="dialog--wide" closeLabel="İptal">
      <div className="screen-picker-grid">
        {sources.map((source) => (
          <button key={source.id} type="button" className="screen-picker-item" onClick={() => onSelect(source.id)}>
            <img src={source.thumbnailDataUrl} alt="" />
            <span>{source.name}</span>
          </button>
        ))}
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
