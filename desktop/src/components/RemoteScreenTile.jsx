// Seste karşı tarafın ekran paylaşımı kutucuğu.
import { useRef, useEffect } from 'react'

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
    <div
      className={'video-tile remote-video-wrapper' + (isEnlarged ? ' video-tile--enlarged' : '')}
      onClick={onToggleEnlarge}
    >
      <video ref={videoRef} autoPlay playsInline className="remote-video remote-video--screen" />
      <span className="remote-video-label">{label} 🖥️ ekranı</span>
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
