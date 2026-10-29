// Ses sahnesindeki bir kutucuk (kamera, avatar ya da ekran). İmza burada:
// konuşan kişinin avatarının etrafında disko topundan yansıyan ışık gibi
// dönen bir halka ve kutucukta süzülen ışık benekleri ("dans pisti").
import { useRef } from 'react'
import { Fullscreen, Maximize2, MicOff, Minimize2, SlidersHorizontal } from 'lucide-react'
import { Avatar } from './Avatar.jsx'

// Ekran paylaşımını tam ekran izlemek (Esc çıkarıyor).
function toggleFullscreen(element) {
  if (document.fullscreenElement) document.exitFullscreen()
  else element?.requestFullscreen?.()
}

export function StageTile({
  className = '',
  name,
  label,
  avatarUrl,
  media,
  showAvatar = false,
  muted = false,
  speaking = false,
  live = false,
  ping,
  isEnlarged,
  onToggleEnlarge,
  onOpenVolume,
}) {
  const tileRef = useRef(null)
  const pingClass = typeof ping !== 'number' ? '' : ping < 100 ? 'good' : ping < 250 ? 'ok' : 'bad'
  return (
    <div
      ref={tileRef}
      className={
        `tile ${className}` + (speaking ? ' is-speaking' : '') + (isEnlarged ? ' video-tile--enlarged' : '')
      }
      onClick={onToggleEnlarge}
      onContextMenu={
        onOpenVolume
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenVolume(e)
            }
          : undefined
      }
    >
      {speaking && showAvatar && <div className="tile-specks" aria-hidden="true" />}
      {media}
      {showAvatar && (
        <div className="tile-avatar">
          <span className={'speaking-ring' + (speaking ? ' is-on' : '')}>
            <Avatar name={name} src={avatarUrl} size="xl" />
          </span>
        </div>
      )}
      <span className="tile-tag remote-video-label">
        {label}
        {muted && <MicOff className="icon tile-muted" aria-label="Mikrofonu kapalı" />}
      </span>
      {live && <span className="tile-live">Canlı</span>}
      {typeof ping === 'number' && !live && (
        <span className={`tile-ping tile-ping--${pingClass}`} title="Gecikme">
          {ping} ms
        </span>
      )}
      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
        {onOpenVolume && (
          <button
            type="button"
            className="icon-btn tile-action"
            onClick={(e) => onOpenVolume(e)}
            aria-label={`${name}: ses seviyesi`}
            title="Ses seviyesi"
          >
            <SlidersHorizontal className="icon" />
          </button>
        )}
        <button
          type="button"
          className="icon-btn tile-action"
          onClick={onToggleEnlarge}
          aria-label={isEnlarged ? 'Küçült' : 'Büyüt'}
          title={isEnlarged ? 'Küçült' : 'Büyüt'}
        >
          {isEnlarged ? <Minimize2 className="icon" /> : <Maximize2 className="icon" />}
        </button>
        {live && (
          <button
            type="button"
            className="icon-btn tile-action"
            onClick={() => toggleFullscreen(tileRef.current)}
            aria-label={`${name}: tam ekran`}
            title="Tam ekran"
          >
            <Fullscreen className="icon" />
          </button>
        )}
      </div>
    </div>
  )
}
