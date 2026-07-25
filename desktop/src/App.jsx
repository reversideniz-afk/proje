import { useState, useRef, useCallback, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SERVER_URL = 'http://localhost:3001'
const CHANNELS = ['Genel', 'Oyun', 'Müzik']

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

function describeMediaError(err) {
  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Kamera/mikrofon izni reddedildi. Windows Ayarları > Gizlilik ve güvenlik > Kamera / Mikrofon bölümünden masaüstü uygulamalarına izin verildiğinden emin ol.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Kamera veya mikrofon bulunamadı.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kamera veya mikrofon başka bir uygulama tarafından kullanılıyor olabilir.'
    default:
      return `Medya erişiminde beklenmeyen bir hata oldu: ${err.message}`
  }
}

function RemoteVideo({ stream, label, cameraOn, micOn, sharingScreen }) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  // Kamera VEYA ekran paylaşımı açıksa video göster — ikisi de aynı
  // "video yuvasını" kullanıyor.
  const showVideo = cameraOn || sharingScreen

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
    if (audioRef.current) audioRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    const activeRef = showVideo ? videoRef : audioRef
    if (activeRef.current) {
      activeRef.current.srcObject = null
      activeRef.current.srcObject = stream
    }
  }, [showVideo, micOn, stream])

  return (
    <div className="remote-video-wrapper">
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={'remote-video' + (sharingScreen ? ' remote-video--screen' : '')}
        />
      ) : (
        <div className="camera-off-placeholder camera-off-placeholder--small">
          <div className="avatar-circle avatar-circle--small">
            {label.charAt(0).toUpperCase()}
          </div>
          <audio ref={audioRef} autoPlay />
        </div>
      )}
      <span className="remote-video-label">
        {label} {!micOn && '🔇'} {sharingScreen && '🖥️'}
      </span>
    </div>
  )
}

function App() {
  const [displayName, setDisplayName] = useState('')
  const [nameConfirmed, setNameConfirmed] = useState(false)
  const [activeChannel, setActiveChannel] = useState(null)
  const [peers, setPeers] = useState([])
  const [connectionError, setConnectionError] = useState(null)

  const [localStream, setLocalStream] = useState(null)
  const [mediaError, setMediaError] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  // Paylaşım bitince kameraya "geri dönmek" için, paylaşım başlamadan
  // hemen önce kameranın açık olup olmadığını hatırlıyoruz.
  const wasCameraOnBeforeShareRef = useRef(false)

  const [remoteStreams, setRemoteStreams] = useState({})

  // YENİ: main.cjs'ten gelen "paylaşılabilecek ekranlar/pencereler"
  // listesi. null = seçim penceresi kapalı, dizi = açık ve bu listeyi
  // gösteriyor.
  const [screenSourceOptions, setScreenSourceOptions] = useState(null)

  useEffect(() => {
    if (!window.electronAPI?.onScreenSources) return
    const unsubscribe = window.electronAPI.onScreenSources((sources) => {
      setScreenSourceOptions(sources)
    })
    return unsubscribe
  }, [])

  const handleSelectScreenSource = useCallback((sourceId) => {
    window.electronAPI?.selectScreenSource(sourceId)
    setScreenSourceOptions(null)
  }, [])

  const handleCancelScreenSource = useCallback(() => {
    window.electronAPI?.selectScreenSource(null)
    setScreenSourceOptions(null)
  }, [])

  const socketRef = useRef(null)
  const localVideoRef = useRef(null)

  const localStreamRef = useRef(null)
  useEffect(() => {
    localStreamRef.current = localStream
  }, [localStream])

  const peerConnectionsRef = useRef(new Map())

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
  }, [])

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach(({ pc }) => pc.close())
    peerConnectionsRef.current.clear()
    setRemoteStreams({})
  }, [])

  const stopLocalMedia = useCallback(() => {
    setLocalStream((prevStream) => {
      if (prevStream) {
        prevStream.getTracks().forEach((track) => track.stop())
      }
      return null
    })
  }, [])

  useEffect(() => {
    return () => {
      cleanupSocket()
      stopLocalMedia()
      cleanupPeerConnections()
    }
  }, [cleanupSocket, stopLocalMedia, cleanupPeerConnections])

  const syncReceiversToStream = useCallback((pc, peerSocketId) => {
    const receivers = pc.getReceivers()
    setRemoteStreams((prev) => {
      const existing = prev[peerSocketId] || new MediaStream()
      let changed = false
      receivers.forEach((receiver) => {
        if (receiver.track && !existing.getTracks().includes(receiver.track)) {
          existing.addTrack(receiver.track)
          changed = true
        }
      })
      if (!changed && prev[peerSocketId]) return prev
      return { ...prev, [peerSocketId]: existing }
    })
  }, [])

  // ------------------------------------------------------------
  // YENİ MİMARİ: Artık yön (direction) ile elle oynamıyoruz, kendi
  // teklifimizi kendimiz oluşturmuyoruz. Bunun yerine WebRTC'nin KENDİ
  // "bir şey değişti, yeniden anlaşmam lazım" mekanizmasına
  // (onnegotiationneeded) güveniyoruz — bu, addTrack/removeTrack
  // çağırdığımızda OTOMATİK tetikleniyor ve hem ilk bağlantıda hem
  // sonraki her değişiklikte AYNI, tek kod yolunu kullanıyor. Bu,
  // WebRTC kütüphanelerinin/örneklerinin standart deseni.
  // ------------------------------------------------------------
  const createPeerConnection = useCallback(
    (peerSocketId) => {
      const pc = new RTCPeerConnection(ICE_SERVERS)

      pc.ontrack = (event) => {
        console.log(
          `[WebRTC ${peerSocketId}] ontrack: kind=${event.track.kind} muted=${event.track.muted}`
        )
        syncReceiversToStream(pc, peerSocketId)
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('signal', {
            to: peerSocketId,
            data: { type: 'ice-candidate', candidate: event.candidate },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC ${peerSocketId}] durum: ${pc.connectionState}`)
      }

      // YENİ: signalingState geçişlerini izliyoruz — "2. açılış çalışıyor
      // ama 1./3./4. çalışmıyor" gibi çok spesifik bir örüntüyü anlamak
      // için, anlaşma sürecinin HANGİ aşamasında olduğumuzu görmemiz lazım.
      pc.onsignalingstatechange = () => {
        console.log(`[WebRTC ${peerSocketId}] signalingState: ${pc.signalingState}`)
      }

      // TEK teklif kaynağı: ilk bağlantı da, sonraki her track
      // ekleme/çıkarma da buradan geçiyor.
      pc.onnegotiationneeded = async () => {
        console.log(
          `[negotiationneeded] ${peerSocketId} TETİKLENDİ - o anki signalingState=${pc.signalingState}`
        )
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socketRef.current?.emit('signal', {
            to: peerSocketId,
            data: { type: 'offer', sdp: pc.localDescription },
          })
          console.log(
            `[negotiationneeded] ${peerSocketId} - teklif gönderildi, yeni signalingState=${pc.signalingState}`
          )
        } catch (err) {
          console.error(`[negotiationneeded] ${peerSocketId} hata:`, err)
        }
      }

      // Medya olsun olmasın, bağlantı kurulur kurulmaz bir "yuva"
      // açılsın ki karşı taraf hemen bir kutucuk görsün (recvonly —
      // şu an gönderecek bir şeyimiz yok ama almaya hazırız).
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.addTransceiver('video', { direction: 'recvonly' })

      // O an elimizde gerçek track varsa (mikrofon/kamera zaten açıksa),
      // standart addTrack ile ekliyoruz — bu, yukarıdaki boş transceiver'ı
      // OTOMATİK olarak bulup yeniden kullanıyor ve yönünü doğru
      // yükseltiyor (elle uğraşmamıza gerek yok, bu addTrack'in kendi işi).
      const audioTrack = localStreamRef.current?.getAudioTracks()[0]
      const videoTrack = localStreamRef.current?.getVideoTracks()[0]
      if (audioTrack) pc.addTrack(audioTrack, localStreamRef.current)
      if (videoTrack) pc.addTrack(videoTrack, localStreamRef.current)

      const entry = { pc }
      peerConnectionsRef.current.set(peerSocketId, entry)
      return entry
    },
    [syncReceiversToStream]
  )

  // YENİ: track eklemek/çıkarmak artık addTrack/removeTrack ile —
  // negotiationneeded'i BİZ tetiklemiyoruz, bu metodların kendisi
  // otomatik tetikliyor.
  const addTrackToAllConnections = useCallback((track, stream) => {
    peerConnectionsRef.current.forEach(({ pc }, peerSocketId) => {
      try {
        pc.addTrack(track, stream)
        console.log(`[addTrack] ${peerSocketId} - ${track.kind} track eklendi`)
      } catch (err) {
        console.error(`[addTrack] ${peerSocketId} hata:`, err)
      }
    })
  }, [])

  const removeTrackFromAllConnections = useCallback((track) => {
    peerConnectionsRef.current.forEach(({ pc }, peerSocketId) => {
      const sender = pc.getSenders().find((s) => s.track === track)
      if (sender) {
        pc.removeTrack(sender)
        console.log(`[removeTrack] ${peerSocketId} - ${track.kind} track çıkarıldı`)
      }
    })
  }, [])

  const joinChannel = useCallback(
    (channelName) => {
      cleanupSocket()
      stopLocalMedia()
      cleanupPeerConnections()
      setPeers([])
      setConnectionError(null)
      setMediaError(null)
      setIsMicOn(false)
      setIsCameraOn(false)
      setIsScreenSharing(false)
      setActiveChannel(channelName)

      const socket = io(SERVER_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        socket.emit('join-room', { roomId: channelName, displayName })
      })

      socket.on('existing-users', (users) => {
        setPeers(users)
      })

      socket.on('user-joined', (user) => {
        setPeers((prev) => [...prev, user])
        // Teklif göndermeyi ARTIK elle yapmıyoruz — createPeerConnection
        // içindeki addTransceiver/addTrack çağrıları onnegotiationneeded'i
        // otomatik tetikleyip teklifi kendisi gönderecek.
        createPeerConnection(user.socketId)
      })

      socket.on('user-left', ({ socketId }) => {
        setPeers((prev) => prev.filter((p) => p.socketId !== socketId))

        const entry = peerConnectionsRef.current.get(socketId)
        if (entry) {
          entry.pc.close()
          peerConnectionsRef.current.delete(socketId)
        }
        setRemoteStreams((prev) => {
          const updated = { ...prev }
          delete updated[socketId]
          return updated
        })
      })

      socket.on('signal', async ({ from, data }) => {
        let entry = peerConnectionsRef.current.get(from)
        if (!entry) {
          entry = createPeerConnection(from)
        }
        const { pc } = entry

        try {
          if (data.type === 'offer') {
            console.log(
              `[signal] ${from} - offer alındı, işlemeden ÖNCE signalingState=${pc.signalingState}`
            )
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('signal', {
              to: from,
              data: { type: 'answer', sdp: pc.localDescription },
            })
            console.log(
              `[signal] ${from} - cevap gönderildi, SONRA signalingState=${pc.signalingState}`
            )
            syncReceiversToStream(pc, from)
          } else if (data.type === 'answer') {
            console.log(
              `[signal] ${from} - answer alındı, işlemeden ÖNCE signalingState=${pc.signalingState}`
            )
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            console.log(
              `[signal] ${from} - answer işlendi, SONRA signalingState=${pc.signalingState}`
            )
            syncReceiversToStream(pc, from)
          } else if (data.type === 'ice-candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          }
        } catch (err) {
          console.error('Sinyal işlenirken hata:', err)
        }
      })

      socket.on('user-state-update', ({ socketId, state }) => {
        setPeers((prev) =>
          prev.map((p) => (p.socketId === socketId ? { ...p, ...state } : p))
        )
      })

      socket.on('connect_error', () => {
        setConnectionError(
          'Sunucuya bağlanılamadı. Sinyalleşme sunucusunun (server klasörü) çalıştığından emin ol.'
        )
      })
    },
    [cleanupSocket, stopLocalMedia, cleanupPeerConnections, createPeerConnection, syncReceiversToStream, displayName]
  )

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  const toggleMic = useCallback(async () => {
    const existingAudioTrack = localStream?.getAudioTracks()[0]

    if (!existingAudioTrack) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const newAudioTrack = micStream.getAudioTracks()[0]
        const otherTracks = localStream ? localStream.getTracks() : []
        const newLocalStream = new MediaStream([...otherTracks, newAudioTrack])
        setLocalStream(newLocalStream)
        setIsMicOn(true)
        addTrackToAllConnections(newAudioTrack, newLocalStream)
        socketRef.current?.emit('state-update', { muted: false })
      } catch (err) {
        setMediaError(describeMediaError(err))
      }
      return
    }

    const newEnabled = !existingAudioTrack.enabled
    existingAudioTrack.enabled = newEnabled
    setIsMicOn(newEnabled)
    socketRef.current?.emit('state-update', { muted: !newEnabled })
  }, [localStream, addTrackToAllConnections])

  const toggleCamera = useCallback(async () => {
    const existingVideoTrack = localStream?.getVideoTracks()[0]

    if (existingVideoTrack && isCameraOn) {
      removeTrackFromAllConnections(existingVideoTrack)
      existingVideoTrack.stop()
      setLocalStream((prev) => {
        const remaining = prev.getTracks().filter((t) => t !== existingVideoTrack)
        return remaining.length > 0 ? new MediaStream(remaining) : null
      })
      setIsCameraOn(false)
      socketRef.current?.emit('state-update', { cameraOn: false })
      return
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const newVideoTrack = camStream.getVideoTracks()[0]
      const otherTracks = localStream ? localStream.getTracks() : []
      const newLocalStream = new MediaStream([...otherTracks, newVideoTrack])
      setLocalStream(newLocalStream)
      setIsCameraOn(true)
      addTrackToAllConnections(newVideoTrack, newLocalStream)
      socketRef.current?.emit('state-update', { cameraOn: true })
    } catch (err) {
      setMediaError(describeMediaError(err))
    }
  }, [localStream, isCameraOn, addTrackToAllConnections, removeTrackFromAllConnections])

  // YENİ: Ekran paylaşımını durdurur. localStreamRef üzerinden okuyoruz
  // (bu fonksiyon dışarıdan — Chrome'un kendi "paylaşımı durdur"
  // arayüzünden de — tetiklenebileceği için sabit/güncel kalması lazım).
  const stopScreenShare = useCallback(async () => {
    const currentStream = localStreamRef.current
    const videoTrack = currentStream?.getVideoTracks()[0]
    if (videoTrack) {
      removeTrackFromAllConnections(videoTrack)
      videoTrack.stop()
    }
    setIsScreenSharing(false)

    if (wasCameraOnBeforeShareRef.current) {
      // Paylaşımdan önce kamera açıktı — kameraya geri dönüyoruz.
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
        const newVideoTrack = camStream.getVideoTracks()[0]
        const otherTracks = currentStream
          ? currentStream.getTracks().filter((t) => t.kind !== 'video')
          : []
        const newLocalStream = new MediaStream([...otherTracks, newVideoTrack])
        setLocalStream(newLocalStream)
        setIsCameraOn(true)
        addTrackToAllConnections(newVideoTrack, newLocalStream)
        socketRef.current?.emit('state-update', { cameraOn: true, sharingScreen: false })
      } catch (err) {
        setMediaError(describeMediaError(err))
        setIsCameraOn(false)
        socketRef.current?.emit('state-update', { cameraOn: false, sharingScreen: false })
      }
    } else {
      const otherTracks = currentStream
        ? currentStream.getTracks().filter((t) => t.kind !== 'video')
        : []
      setLocalStream(otherTracks.length > 0 ? new MediaStream(otherTracks) : null)
      setIsCameraOn(false)
      socketRef.current?.emit('state-update', { cameraOn: false, sharingScreen: false })
    }
  }, [addTrackToAllConnections, removeTrackFromAllConnections])

  // YENİ: Ekran paylaşımını başlatır.
  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = screenStream.getVideoTracks()[0]

      // Kullanıcı paylaşımı BİZİM butonumuzdan değil, Chrome/Windows'un
      // kendi "Paylaşımı durdur" çubuğundan durdurursa, bunu yakalayıp
      // kendi state'imizi senkron tutuyoruz.
      screenTrack.onended = () => {
        stopScreenShare()
      }

      wasCameraOnBeforeShareRef.current = isCameraOn

      const existingVideoTrack = localStream?.getVideoTracks()[0]
      if (existingVideoTrack) {
        removeTrackFromAllConnections(existingVideoTrack)
        existingVideoTrack.stop()
      }

      const otherTracks = localStream
        ? localStream.getTracks().filter((t) => t.kind !== 'video')
        : []
      const newLocalStream = new MediaStream([...otherTracks, screenTrack])
      setLocalStream(newLocalStream)
      setIsCameraOn(false)
      setIsScreenSharing(true)
      addTrackToAllConnections(screenTrack, newLocalStream)
      socketRef.current?.emit('state-update', { cameraOn: false, sharingScreen: true })
    } catch (err) {
      // Kullanıcı seçim penceresinde "İptal" dediyse sessizce geç.
      if (err.name !== 'NotAllowedError') {
        setMediaError(describeMediaError(err))
      }
    }
  }, [localStream, isCameraOn, addTrackToAllConnections, removeTrackFromAllConnections, stopScreenShare])

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      startScreenShare()
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare])

  if (!nameConfirmed) {
    return (
      <div className="name-entry">
        <h1>Sesli Sohbet</h1>
        <p>Önce bir isim gir:</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (displayName.trim().length > 0) {
              setNameConfirmed(true)
            }
          }}
        >
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Adın"
            autoFocus
          />
          <button type="submit">Devam Et</button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="channel-sidebar">
        <h1 className="app-title">Sesli Sohbet</h1>
        <p className="whoami">{displayName} olarak bağlısın</p>
        <nav className="channel-list">
          {CHANNELS.map((channel) => (
            <button
              key={channel}
              className={
                'channel-button' +
                (activeChannel === channel ? ' channel-button--active' : '')
              }
              onClick={() => joinChannel(channel)}
            >
              # {channel}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        {connectionError && <p className="error-text">{connectionError}</p>}

        {!activeChannel && !connectionError && (
          <p>Başlamak için soldan bir kanal seç.</p>
        )}

        {activeChannel && !connectionError && (
          <div className="channel-view">
            <div className="peer-panel">
              <h2># {activeChannel}</h2>
              <p>Odadakiler ({peers.length + 1}):</p>
              <ul className="peer-list">
                <li>
                  {displayName} (sen) {!isMicOn && '🔇'}{' '}
                  {!isCameraOn && !isScreenSharing && '📷'} {isScreenSharing && '🖥️'}
                </li>
                {peers.map((p) => (
                  <li key={p.socketId}>
                    {p.displayName} {p.muted && '🔇'}{' '}
                    {!p.cameraOn && !p.sharingScreen && '📷'} {p.sharingScreen && '🖥️'}
                  </li>
                ))}
              </ul>
            </div>

            <div className="video-grid">
              <div className="local-media-panel">
                {mediaError && <p className="error-text">{mediaError}</p>}

                {isCameraOn || isScreenSharing ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={
                      'local-video' + (isScreenSharing ? ' local-video--screen' : '')
                    }
                  />
                ) : (
                  <div className="camera-off-placeholder">
                    <div className="avatar-circle">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}

                <div className="media-controls">
                  <button
                    className={
                      'control-button' + (isMicOn ? '' : ' control-button--off')
                    }
                    onClick={toggleMic}
                    title={isMicOn ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
                  >
                    {isMicOn ? '🎤' : '🔇'}
                  </button>
                  <button
                    className={
                      'control-button' +
                      (isCameraOn ? '' : ' control-button--off')
                    }
                    onClick={toggleCamera}
                    title={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
                    disabled={isScreenSharing}
                  >
                    {isCameraOn ? '🎥' : '📷'}
                  </button>
                  <button
                    className={
                      'control-button' +
                      (isScreenSharing ? '' : ' control-button--off')
                    }
                    onClick={toggleScreenShare}
                    title={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
                  >
                    {isScreenSharing ? '🛑' : '🖥️'}
                  </button>
                </div>
              </div>

              {Object.entries(remoteStreams).map(([socketId, stream]) => {
                const peer = peers.find((p) => p.socketId === socketId)
                return (
                  <RemoteVideo
                    key={socketId}
                    stream={stream}
                    label={peer ? peer.displayName : '...'}
                    cameraOn={peer ? peer.cameraOn : false}
                    micOn={peer ? !peer.muted : false}
                    sharingScreen={peer ? peer.sharingScreen : false}
                  />
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* YENİ: Ekran paylaşımı kaynak seçici — main.cjs bir liste
          gönderdiğinde açılır, kullanıcı seçim yapana/iptal edene kadar
          açık kalır. */}
      {screenSourceOptions && (
        <div className="screen-picker-overlay">
          <div className="screen-picker-modal">
            <h2>Neyi paylaşmak istersin?</h2>
            <div className="screen-picker-grid">
              {screenSourceOptions.map((source) => (
                <button
                  key={source.id}
                  className="screen-picker-item"
                  onClick={() => handleSelectScreenSource(source.id)}
                >
                  <img src={source.thumbnailDataUrl} alt={source.name} />
                  <span>{source.name}</span>
                </button>
              ))}
            </div>
            <button className="screen-picker-cancel" onClick={handleCancelScreenSource}>
              İptal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
