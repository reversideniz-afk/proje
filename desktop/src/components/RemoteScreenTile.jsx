// Seste karşı tarafın ekran paylaşımı kutucuğu.
import { useRef, useEffect } from 'react'
import { StageTile } from './StageTile.jsx'

// Karşı tarafın EKRAN paylaşımı — kameradan ayrı, kendi kutucuğu.
// NOT: bu kutucuğun sesi (varsa) mikrofon sesi gibi Web Audio üzerinden
// DEĞİL, doğrudan bu <video> elemanı üzerinden çalıyor — bu yüzden
// kullanıcının seçtiği çıkış cihazını (outputDeviceId) ayrıca burada da
// setSinkId ile uygulamamız gerekiyor, yoksa hep sistem varsayılanına gider.
export function RemoteScreenTile({ stream, label, isEnlarged, onToggleEnlarge, outputDeviceId }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.srcObject = stream
    }
  }, [stream])

  useEffect(() => {
    if (!videoRef.current || !outputDeviceId) return
    if (typeof videoRef.current.setSinkId !== 'function') return
    videoRef.current.setSinkId(outputDeviceId).catch(() => {
      // Sessizce geç — bu sadece "tercih edilen çıkışa" yönlendirme,
      // başarısız olursa tarayıcı zaten varsayılan çıkışta kalır.
    })
  }, [outputDeviceId, stream])

  return (
    <StageTile
      className="remote-video-wrapper tile--screen"
      name={label}
      label={`${label} · ekran`}
      live
      isEnlarged={isEnlarged}
      onToggleEnlarge={onToggleEnlarge}
      media={<video ref={videoRef} autoPlay playsInline className="remote-video remote-video--screen" />}
    />
  )
}
