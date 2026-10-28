// Seste karşı tarafın kamera kutucuğu.
import { useRef, useEffect } from 'react'

// Karşı tarafın kamera görüntüsü (ya da kamerası kapalıysa avatar).
// YENİ: tıklanınca büyütülüyor (isEnlarged/onToggleEnlarge).
export function RemoteCameraTile({
  stream,
  label,
  cameraOn,
  micOn,
  isEnlarged,
  onToggleEnlarge,
  onOpenVolumeMenu,
  ping,
  avatarUrl,
}) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
    if (audioRef.current) audioRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    const activeRef = cameraOn ? videoRef : audioRef
    if (activeRef.current) {
      activeRef.current.srcObject = null
      activeRef.current.srcObject = stream
    }
  }, [cameraOn, micOn, stream])

  // YENİ: ping değerine göre renk — düşükse yeşilimsi, yüksekse turuncu/kırmızımsı.
  const pingClass =
    typeof ping !== 'number' ? '' : ping < 100 ? 'ping-good' : ping < 250 ? 'ping-ok' : 'ping-bad'

  return (
    <div
      className={'video-tile remote-video-wrapper' + (isEnlarged ? ' video-tile--enlarged' : '')}
      onClick={onToggleEnlarge}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenVolumeMenu(e)
      }}
    >
      {cameraOn ? (
        // YENİ: gerçek ses artık Web Audio üzerinden (kişi bazlı ses
        // seviyesi için) çalıyor — bu elemanın kendi sesini kapatıyoruz
        // (muted) ki aynı ses iki kere duyulmasın.
        <video ref={videoRef} autoPlay playsInline muted className="remote-video" />
      ) : (
        <div className="camera-off-placeholder">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="avatar-circle avatar-circle--photo" />
          ) : (
            <div className="avatar-circle">{label.charAt(0).toUpperCase()}</div>
          )}
          <audio ref={audioRef} autoPlay muted />
        </div>
      )}
      <span className="remote-video-label">
        {label} {!micOn && '🔇'}
      </span>
      {typeof ping === 'number' && (
        <span className={'ping-badge ' + pingClass}>{ping} ms</span>
      )}
      {isEnlarged && (
        <button
          className="enlarged-tile-close"
          onClick={(e) => {
            e.stopPropagation()
            onToggleEnlarge()
          }}
          title="Küçült"
        >
          ✕
        </button>
      )}
    </div>
  )
}
