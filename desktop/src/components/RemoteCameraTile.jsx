// Seste karşı tarafın kutucuğu: kamerası açıksa görüntüsü, kapalıysa avatarı.
import { useRef, useEffect } from 'react'
import { StageTile } from './StageTile.jsx'

// YENİ: tıklanınca büyütülüyor (isEnlarged/onToggleEnlarge).
export function RemoteCameraTile({
  stream,
  label,
  cameraOn,
  micOn,
  speaking,
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

  return (
    <StageTile
      className="remote-video-wrapper"
      name={label}
      label={label}
      avatarUrl={avatarUrl}
      muted={!micOn}
      speaking={speaking}
      ping={ping}
      isEnlarged={isEnlarged}
      onToggleEnlarge={onToggleEnlarge}
      onOpenVolume={onOpenVolumeMenu}
      media={
        cameraOn ? (
          // Ses Web Audio üzerinden (kişi bazlı ses seviyesi için) çalıyor;
          // bu eleman susturuluyor ki aynı ses iki kez duyulmasın.
          <video ref={videoRef} autoPlay playsInline muted className="remote-video" />
        ) : (
          <audio ref={audioRef} autoPlay muted />
        )
      }
      showAvatar={!cameraOn}
    />
  )
}
