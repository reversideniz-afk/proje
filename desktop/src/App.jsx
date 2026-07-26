import { useState, useRef, useCallback, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SERVER_URL = 'https://proje-dh7l.onrender.com'

// YENİ: TURN bilgileri koda GÖMÜLMÜYOR — girişten sonra sunucudan geliyor.
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// YENİ: bas-konuş için seçilen tuşu (event.code) okunabilir göstermek için.
function formatKeyCode(code) {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Boşluk'
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt'
  return code
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

// Karşı tarafın kamera görüntüsü (ya da kamerası kapalıysa avatar).
// YENİ: tıklanınca büyütülüyor (isEnlarged/onToggleEnlarge).
function RemoteCameraTile({
  stream,
  label,
  cameraOn,
  micOn,
  isEnlarged,
  onToggleEnlarge,
  volume,
  onVolumeChange,
  showVolumeMenu,
  onOpenVolumeMenu,
  onCloseVolumeMenu,
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
    <div
      className={'video-tile remote-video-wrapper' + (isEnlarged ? ' video-tile--enlarged' : '')}
      onClick={onToggleEnlarge}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenVolumeMenu()
      }}
    >
      {cameraOn ? (
        // YENİ: gerçek ses artık Web Audio üzerinden (kişi bazlı ses
        // seviyesi için) çalıyor — bu elemanın kendi sesini kapatıyoruz
        // (muted) ki aynı ses iki kere duyulmasın.
        <video ref={videoRef} autoPlay playsInline muted className="remote-video" />
      ) : (
        <div className="camera-off-placeholder">
          <div className="avatar-circle">{label.charAt(0).toUpperCase()}</div>
          <audio ref={audioRef} autoPlay muted />
        </div>
      )}
      <span className="remote-video-label">
        {label} {!micOn && '🔇'}
      </span>

      {/* YENİ: sağ tık ile açılan, kişiye özel ses seviyesi kaydırıcısı. */}
      {showVolumeMenu && (
        <div className="volume-popup" onClick={(e) => e.stopPropagation()}>
          <div className="volume-popup-header">
            <span>{label} — ses seviyesi</span>
            <button className="volume-popup-close" onClick={onCloseVolumeMenu}>
              ✕
            </button>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
          />
          <div className="volume-popup-value">{volume}%</div>
        </div>
      )}
    </div>
  )
}

// Karşı tarafın EKRAN paylaşımı — kameradan ayrı, kendi kutucuğu.
function RemoteScreenTile({ stream, label, isEnlarged, onToggleEnlarge }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div
      className={'video-tile remote-video-wrapper' + (isEnlarged ? ' video-tile--enlarged' : '')}
      onClick={onToggleEnlarge}
    >
      <video ref={videoRef} autoPlay playsInline className="remote-video remote-video--screen" />
      <span className="remote-video-label">{label} 🖥️ ekranı</span>
    </div>
  )
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.5A9.9 9.9 0 0112 5c5 0 9 4 10 7-.4 1.1-1.1 2.3-2.1 3.4M6.3 6.3C4.4 7.6 3 9.6 2 12c1 3 5 7 10 7 1.3 0 2.5-.2 3.6-.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path
        d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7s-9-4-10-7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function App() {
  // --- Kişisel hesap girişi ---
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const displayName = username

  const [sessionToken, setSessionToken] = useState(null)
  const sessionTokenRef = useRef(null)
  useEffect(() => {
    sessionTokenRef.current = sessionToken
  }, [sessionToken])

  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS)
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS)
  useEffect(() => {
    iceServersRef.current = iceServers
  }, [iceServers])

  // YENİ: kanal listesi artık sunucudan geliyor (koda gömülü değil).
  const [channels, setChannels] = useState([])

  // --- Kanal (metin) durumu ---
  const [activeChannel, setActiveChannel] = useState(null)
  const [pendingChannel, setPendingChannel] = useState(null)
  const [channelPasswordInput, setChannelPasswordInput] = useState('')
  const [showChannelPassword, setShowChannelPassword] = useState(false)
  const [connectionError, setConnectionError] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('connected')

  // YENİ: üye listesi (Discord tarzı, sağda) — online (metin kanalına
  // bağlı herkes, seste olanlar ayrıca işaretli) + offline (daha önce
  // bu kanala girmiş ama şu an bağlı olmayanlar).
  const [onlineMembers, setOnlineMembers] = useState([])
  const [offlineMembers, setOfflineMembers] = useState([])

  // YENİ: sese girmek artık AYRI, isteğe bağlı bir adım.
  const [inVoice, setInVoice] = useState(false)

  // --- Sohbet ---
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)

  // --- Mikrofon + kamera (ana bağlantı) ---
  const [localMainStream, setLocalMainStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)

  // YENİ: Bas-konuş (push-to-talk) — uygulama odaktayken çalışan versiyon.
  const [pttEnabled, setPttEnabled] = useState(false)
  const [pttKey, setPttKey] = useState(null) // event.code, ör. 'KeyV'
  const [isCapturingPttKey, setIsCapturingPttKey] = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(false)

  // --- Ekran paylaşımı (tamamen ayrı akış/bağlantı) ---
  const [localScreenStream, setLocalScreenStream] = useState(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  const [remoteStreams, setRemoteStreams] = useState({})
  const [peers, setPeers] = useState([]) // artık SADECE seste olanlar
  const [mediaError, setMediaError] = useState(null)
  const [screenSourceOptions, setScreenSourceOptions] = useState(null)

  // YENİ: büyütülmüş kutucuk — bir video/ekran kutucuğuna tıklayınca
  // o kutucuk büyür, diğerleri küçük bir şeride iner.
  const [enlargedTile, setEnlargedTile] = useState(null)
  const toggleEnlarge = (tileId) => {
    setEnlargedTile((prev) => (prev === tileId ? null : tileId))
  }

  // YENİ: kişi bazlı ses seviyesi (Discord'daki gibi, %0-%200 arası —
  // normal HTML ses elemanlarının %100 sınırını Web Audio API ile aşıyoruz).
  const [peerVolumes, setPeerVolumes] = useState({}) // { peerSocketId: 0-200 }
  const [volumeMenuFor, setVolumeMenuFor] = useState(null) // hangi kişinin kaydırıcısı açık
  const audioContextRef = useRef(null)
  const gainNodesRef = useRef(new Map()) // peerSocketId -> GainNode
  const connectedAudioTracksRef = useRef(new Map()) // peerSocketId -> hangi track'e bağlandık

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  // Her uzak ses akışı için (ya da akış değiştiğinde) bir kazanç (gain)
  // düğümü kuruyoruz — bu, kişi bazlı ses seviyesinin gerçek mekanizması.
  useEffect(() => {
    Object.entries(remoteStreams).forEach(([peerSocketId, streams]) => {
      const audioTrack = streams.mainStream?.getAudioTracks()[0]
      if (!audioTrack) return
      if (connectedAudioTracksRef.current.get(peerSocketId) === audioTrack) return

      try {
        const ctx = getAudioContext()
        const singleTrackStream = new MediaStream([audioTrack])
        const source = ctx.createMediaStreamSource(singleTrackStream)
        const gainNode = ctx.createGain()
        const currentVolume = peerVolumes[peerSocketId] ?? 100
        gainNode.gain.value = currentVolume / 100
        source.connect(gainNode).connect(ctx.destination)

        // Eskiden bu kişi için bağlı bir düğüm varsa (ör. track değişti),
        // eskisini temizleyelim ki sesler üst üste binmesin.
        const oldGainNode = gainNodesRef.current.get(peerSocketId)
        if (oldGainNode) {
          try {
            oldGainNode.disconnect()
          } catch {
            /* zaten kopmuş olabilir, sorun değil */
          }
        }

        gainNodesRef.current.set(peerSocketId, gainNode)
        connectedAudioTracksRef.current.set(peerSocketId, audioTrack)
      } catch (err) {
        console.error(`[ses seviyesi] ${peerSocketId} için kurulamadı:`, err)
      }
    })

    // Artık remoteStreams'te olmayan kişilerin düğümlerini temizle.
    gainNodesRef.current.forEach((gainNode, peerSocketId) => {
      if (!remoteStreams[peerSocketId]?.mainStream) {
        gainNode.disconnect()
        gainNodesRef.current.delete(peerSocketId)
        connectedAudioTracksRef.current.delete(peerSocketId)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStreams, getAudioContext])

  const setPeerVolume = useCallback((peerSocketId, percent) => {
    setPeerVolumes((prev) => ({ ...prev, [peerSocketId]: percent }))
    const gainNode = gainNodesRef.current.get(peerSocketId)
    if (gainNode) gainNode.gain.value = percent / 100
  }, [])

  const socketRef = useRef(null)
  const localVideoRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const localScreenVideoRef = useRef(null)

  const localMainStreamRef = useRef(null)

  useEffect(() => {
    localMainStreamRef.current = localMainStream
  }, [localMainStream])

  const localScreenStreamRef = useRef(null)
  useEffect(() => {
    localScreenStreamRef.current = localScreenStream
  }, [localScreenStream])

  // peerConnectionsRef: Map<peerSocketId, { mainPc, screenPc }>
  const peerConnectionsRef = useRef(new Map())

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

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
  }, [])

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach(({ mainPc, screenPc }) => {
      if (mainPc) mainPc.close()
      if (screenPc) screenPc.close()
    })
    peerConnectionsRef.current.clear()
    setRemoteStreams({})
  }, [])

  const stopLocalMedia = useCallback(() => {
    setLocalMainStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop())
      return null
    })
    setLocalScreenStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop())
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

  const syncReceiversToStream = useCallback((pc, peerSocketId, connectionType) => {
    const streamKey = connectionType === 'screen' ? 'screenStream' : 'mainStream'
    const receivers = pc.getReceivers()
    setRemoteStreams((prev) => {
      const peerEntry = prev[peerSocketId] || {}
      const existing = peerEntry[streamKey] || new MediaStream()
      let changed = false
      receivers.forEach((receiver) => {
        if (receiver.track && !existing.getTracks().includes(receiver.track)) {
          existing.addTrack(receiver.track)
          changed = true
        }
      })
      if (!changed && peerEntry[streamKey]) return prev
      return { ...prev, [peerSocketId]: { ...peerEntry, [streamKey]: existing } }
    })
  }, [])

  const createSubConnection = useCallback(
    (peerSocketId, connectionType) => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })

      pc.ontrack = () => {
        syncReceiversToStream(pc, peerSocketId, connectionType)
      }
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit('signal', {
            to: peerSocketId,
            data: { type: 'ice-candidate', candidate: event.candidate, connectionType },
          })
        }
      }
      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC ${peerSocketId}/${connectionType}] durum: ${pc.connectionState}`)
      }
      pc.onnegotiationneeded = async () => {
        if (pc.makingOffer) return
        pc.makingOffer = true
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          socketRef.current?.emit('signal', {
            to: peerSocketId,
            data: { type: 'offer', sdp: pc.localDescription, connectionType },
          })
        } catch (err) {
          console.error(`[negotiationneeded] ${peerSocketId}/${connectionType} hata:`, err)
        } finally {
          pc.makingOffer = false
        }
      }
      return pc
    },
    [syncReceiversToStream]
  )

  const getOrCreateMainConnection = useCallback(
    (peerSocketId) => {
      let entry = peerConnectionsRef.current.get(peerSocketId)
      if (!entry) {
        entry = { mainPc: null, screenPc: null }
        peerConnectionsRef.current.set(peerSocketId, entry)
      }
      if (!entry.mainPc) {
        const pc = createSubConnection(peerSocketId, 'main')
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.addTransceiver('video', { direction: 'recvonly' })
        const audioTrack = localMainStreamRef.current?.getAudioTracks()[0]
        const videoTrack = localMainStreamRef.current?.getVideoTracks()[0]
        if (audioTrack) pc.addTrack(audioTrack, localMainStreamRef.current)
        if (videoTrack) pc.addTrack(videoTrack, localMainStreamRef.current)
        entry.mainPc = pc
      }
      return entry.mainPc
    },
    [createSubConnection]
  )

  const getOrCreateScreenConnection = useCallback(
    (peerSocketId) => {
      let entry = peerConnectionsRef.current.get(peerSocketId)
      if (!entry) {
        entry = { mainPc: null, screenPc: null }
        peerConnectionsRef.current.set(peerSocketId, entry)
      }
      if (!entry.screenPc) {
        const pc = createSubConnection(peerSocketId, 'screen')
        const screenTrack = localScreenStreamRef.current?.getVideoTracks()[0]
        if (screenTrack) pc.addTrack(screenTrack, localScreenStreamRef.current)
        entry.screenPc = pc
      }
      return entry.screenPc
    },
    [createSubConnection]
  )

  const ensureMainConnectionsForAllPeers = useCallback(() => {
    peers.forEach((peer) => {
      const entry = peerConnectionsRef.current.get(peer.socketId)
      if (!entry || !entry.mainPc) {
        getOrCreateMainConnection(peer.socketId)
      }
    })
  }, [peers, getOrCreateMainConnection])

  const addTrackToMainConnections = useCallback(
    (track, stream) => {
      ensureMainConnectionsForAllPeers()
      peerConnectionsRef.current.forEach(({ mainPc }, peerSocketId) => {
        if (!mainPc) return
        try {
          mainPc.addTrack(track, stream)
          console.log(`[addTrack/main] ${peerSocketId} - ${track.kind} eklendi`)
        } catch (err) {
          console.error(`[addTrack/main] ${peerSocketId} hata:`, err)
        }
      })
    },
    [ensureMainConnectionsForAllPeers]
  )

  const removeTrackFromMainConnections = useCallback((track) => {
    peerConnectionsRef.current.forEach(({ mainPc }, peerSocketId) => {
      if (!mainPc) return
      const sender = mainPc.getSenders().find((s) => s.track === track)
      if (sender) {
        mainPc.removeTrack(sender)
        console.log(`[removeTrack/main] ${peerSocketId} - ${track.kind} çıkarıldı`)
      }
    })
  }, [])

  const addTrackToScreenConnections = useCallback(
    (track, stream) => {
      peers.forEach((peer) => {
        const pc = getOrCreateScreenConnection(peer.socketId)
        try {
          pc.addTrack(track, stream)
          console.log(`[addTrack/screen] ${peer.socketId} - eklendi`)
        } catch (err) {
          console.error(`[addTrack/screen] ${peer.socketId} hata:`, err)
        }
      })
    },
    [peers, getOrCreateScreenConnection]
  )

  const removeTrackFromScreenConnectionsAndClose = useCallback((track) => {
    peerConnectionsRef.current.forEach((entry, peerSocketId) => {
      if (!entry.screenPc) return
      const sender = entry.screenPc.getSenders().find((s) => s.track === track)
      if (sender) entry.screenPc.removeTrack(sender)
      entry.screenPc.close()
      entry.screenPc = null
      console.log(`[screen] ${peerSocketId} - ekran bağlantısı kapatıldı`)
      setRemoteStreams((prev) => {
        const peerEntry = prev[peerSocketId]
        if (!peerEntry) return prev
        return { ...prev, [peerSocketId]: { ...peerEntry, screenStream: undefined } }
      })
    })
  }, [])

  // YENİ: Sesten çık — metin kanalında KALMAYA devam ediyoruz, sadece
  // WebRTC/medya bağlantılarını kapatıyoruz.
  const leaveVoice = useCallback(() => {
    socketRef.current?.emit('leave-voice')
    stopLocalMedia()
    cleanupPeerConnections()
    setPeers([])
    setIsMicOn(false)
    setIsCameraOn(false)
    setIsScreenSharing(false)
    setEnlargedTile(null)
    setInVoice(false)
    setVolumeMenuFor(null)
    // YENİ: ses seviyesi düğümlerini de temizle (bir sonraki sese
    // girişte sıfırdan, temiz kurulacaklar).
    gainNodesRef.current.forEach((gainNode) => gainNode.disconnect())
    gainNodesRef.current.clear()
    connectedAudioTracksRef.current.clear()
  }, [stopLocalMedia, cleanupPeerConnections])

  // YENİ: Sese katıl — metin kanalına ZATEN girmiş olmamız lazım.
  const joinVoice = useCallback(() => {
    if (!socketRef.current) return
    socketRef.current.emit('join-voice', { token: sessionTokenRef.current })
    setInVoice(true)
  }, [])

  const leaveChannel = useCallback(() => {
    cleanupSocket()
    stopLocalMedia()
    cleanupPeerConnections()
    setPeers([])
    setMessages([])
    setHasMoreHistory(true)
    setOnlineMembers([])
    setOfflineMembers([])
    setConnectionError(null)
    setMediaError(null)
    setIsMicOn(false)
    setIsCameraOn(false)
    setIsScreenSharing(false)
    setConnectionStatus('connected')
    setInVoice(false)
    setEnlargedTile(null)
    setActiveChannel(null)
  }, [cleanupSocket, stopLocalMedia, cleanupPeerConnections])

  // YENİ: Kanala (METİN) katılma — ses bağlantısı burada HİÇ kurulmuyor.
  const joinChannel = useCallback(
    (channelName, channelSecret) => {
      cleanupSocket()
      stopLocalMedia()
      cleanupPeerConnections()
      setPeers([])
      setMessages([])
      setHasMoreHistory(true)
      setOnlineMembers([])
      setOfflineMembers([])
      setConnectionError(null)
      setMediaError(null)
      setIsMicOn(false)
      setIsCameraOn(false)
      setIsScreenSharing(false)
      setConnectionStatus('connected')
      setInVoice(false)
      setEnlargedTile(null)
      setActiveChannel(channelName)

      const socket = io(SERVER_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        setConnectionStatus('connected')
        socket.emit('join-channel', {
          roomId: channelName,
          token: sessionTokenRef.current,
          secret: channelSecret,
        })
      })

      socket.on('disconnect', () => {
        setConnectionStatus('reconnecting')
      })

      socket.on('join-error', (message) => {
        setConnectionError(message || 'Kanala katılamadın.')
        cleanupSocket()
        setActiveChannel(null)
      })

      // YENİ: üye listesi (online + offline) — tek doğru kaynak.
      socket.on('channel-members', ({ online, offline }) => {
        setOnlineMembers(online || [])
        setOfflineMembers(offline || [])
      })

      socket.on('message-history', (history) => {
        setMessages(history)
        setHasMoreHistory(history.length >= 50)
        requestAnimationFrame(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
          }
        })
      })

      socket.on('new-message', (message) => {
        setMessages((prev) => [...prev, message])
        requestAnimationFrame(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
          }
        })
      })

      // ---- Ses (voice) ile ilgili dinleyiciler — 'sese katıl' denene kadar
      // tetiklenmezler ama baştan hazır olmaları lazım. ----
      socket.on('existing-voice-users', (users) => {
        setPeers(users)
      })

      socket.on('voice-user-joined', (user) => {
        setPeers((prev) => [...prev, user])
        getOrCreateMainConnection(user.socketId)
      })

      socket.on('voice-user-left', ({ socketId }) => {
        setPeers((prev) => prev.filter((p) => p.socketId !== socketId))
        const entry = peerConnectionsRef.current.get(socketId)
        if (entry) {
          if (entry.mainPc) entry.mainPc.close()
          if (entry.screenPc) entry.screenPc.close()
          peerConnectionsRef.current.delete(socketId)
        }
        setRemoteStreams((prev) => {
          const updated = { ...prev }
          delete updated[socketId]
          return updated
        })
      })

      socket.on('signal', async ({ from, data }) => {
        const connectionType = data.connectionType === 'screen' ? 'screen' : 'main'
        let entry = peerConnectionsRef.current.get(from)
        if (!entry) {
          entry = { mainPc: null, screenPc: null }
          peerConnectionsRef.current.set(from, entry)
        }
        const pc =
          connectionType === 'screen'
            ? entry.screenPc || getOrCreateScreenConnection(from)
            : entry.mainPc || getOrCreateMainConnection(from)

        try {
          if (data.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('signal', {
              to: from,
              data: { type: 'answer', sdp: pc.localDescription, connectionType },
            })
            syncReceiversToStream(pc, from, connectionType)
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            syncReceiversToStream(pc, from, connectionType)
          } else if (data.type === 'ice-candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          }
        } catch (err) {
          console.error(`[signal] ${from}/${connectionType} - hata (bağlantı sıfırlanıyor):`, err)
          pc.close()
          if (connectionType === 'screen') entry.screenPc = null
          else entry.mainPc = null
          setRemoteStreams((prev) => {
            const peerEntry = prev[from] || {}
            const updated = { ...peerEntry }
            delete updated[connectionType === 'screen' ? 'screenStream' : 'mainStream']
            return { ...prev, [from]: updated }
          })
        }
      })

      socket.on('user-state-update', ({ socketId, state }) => {
        setPeers((prev) => prev.map((p) => (p.socketId === socketId ? { ...p, ...state } : p)))
      })
    },
    [
      cleanupSocket,
      stopLocalMedia,
      cleanupPeerConnections,
      getOrCreateMainConnection,
      getOrCreateScreenConnection,
      syncReceiversToStream,
    ]
  )

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localMainStream
  }, [localMainStream])

  useEffect(() => {
    if (localScreenVideoRef.current) {
      localScreenVideoRef.current.srcObject = null
      localScreenVideoRef.current.srcObject = localScreenStream
    }
  }, [localScreenStream])

  // YENİ: mikrofonu DOĞRUDAN bir duruma getiren fonksiyon (toggle değil,
  // "aç" ya da "kapat" diye kesin bir komut) — hem normal buton hem de
  // bas-konuş bunu kullanıyor, mantık tek bir yerde.
  const setMicActive = useCallback(
    async (active) => {
      const existingAudioTrack = localMainStream?.getAudioTracks()[0]
      if (!existingAudioTrack) {
        if (!active) return // mikrofon hiç açılmamışken "kapat" demenin bir anlamı yok
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const newAudioTrack = micStream.getAudioTracks()[0]
          const otherTracks = localMainStream ? localMainStream.getTracks() : []
          const newLocalStream = new MediaStream([...otherTracks, newAudioTrack])
          setLocalMainStream(newLocalStream)
          setIsMicOn(true)
          addTrackToMainConnections(newAudioTrack, newLocalStream)
          socketRef.current?.emit('state-update', { muted: false })
        } catch (err) {
          setMediaError(describeMediaError(err))
        }
        return
      }
      existingAudioTrack.enabled = active
      setIsMicOn(active)
      socketRef.current?.emit('state-update', { muted: !active })
    },
    [localMainStream, addTrackToMainConnections]
  )

  const toggleMic = useCallback(() => {
    setMicActive(!isMicOn)
  }, [isMicOn, setMicActive])

  // YENİ: Bas-konuş ayarlama — butona basınca bir sonraki tuşu bekliyoruz.
  const handleTogglePtt = () => {
    if (pttEnabled) {
      setPttEnabled(false)
      setPttKey(null)
      setMicActive(false)
    } else {
      setIsCapturingPttKey(true)
    }
  }

  // Bir sonraki tuş basışını "bas-konuş tuşu" olarak yakala.
  useEffect(() => {
    if (!isCapturingPttKey) return
    const handleKeydown = (e) => {
      e.preventDefault()
      setPttKey(e.code)
      setPttEnabled(true)
      setIsCapturingPttKey(false)
      setMicActive(false) // başlangıçta kapalı — tuşa basınca açılacak
    }
    window.addEventListener('keydown', handleKeydown, { once: true })
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [isCapturingPttKey, setMicActive])

  // Bas-konuş AKTİFKEN: tuş basılıyken mikrofon açık, bırakınca kapalı.
  // NOT: sohbet kutusuna yazarken tetiklenmesin diye input/textarea
  // üzerindeyken bu dinleyiciyi devre dışı bırakıyoruz.
  useEffect(() => {
    if (!pttEnabled || !inVoice || !pttKey) return

    const isTypingTarget = (e) =>
      e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'

    const handleKeydown = (e) => {
      if (isTypingTarget(e)) return
      if (e.code === pttKey && !e.repeat) {
        setMicActive(true)
      }
    }
    const handleKeyup = (e) => {
      if (isTypingTarget(e)) return
      if (e.code === pttKey) {
        setMicActive(false)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('keyup', handleKeyup)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('keyup', handleKeyup)
    }
  }, [pttEnabled, pttKey, inVoice, setMicActive])

  const toggleCamera = useCallback(async () => {
    const existingVideoTrack = localMainStream?.getVideoTracks()[0]
    if (existingVideoTrack && isCameraOn) {
      removeTrackFromMainConnections(existingVideoTrack)
      existingVideoTrack.stop()
      setLocalMainStream((prev) => {
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
      const otherTracks = localMainStream ? localMainStream.getTracks() : []
      const newLocalStream = new MediaStream([...otherTracks, newVideoTrack])
      setLocalMainStream(newLocalStream)
      setIsCameraOn(true)
      addTrackToMainConnections(newVideoTrack, newLocalStream)
      socketRef.current?.emit('state-update', { cameraOn: true })
    } catch (err) {
      setMediaError(describeMediaError(err))
    }
  }, [localMainStream, isCameraOn, addTrackToMainConnections, removeTrackFromMainConnections])

  const stopScreenShare = useCallback(() => {
    const screenTrack = localScreenStreamRef.current?.getVideoTracks()[0]
    if (screenTrack) {
      removeTrackFromScreenConnectionsAndClose(screenTrack)
      screenTrack.stop()
    }
    setLocalScreenStream(null)
    setIsScreenSharing(false)
    socketRef.current?.emit('state-update', { sharingScreen: false })
  }, [removeTrackFromScreenConnectionsAndClose])

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenTrack = screenStream.getVideoTracks()[0]
      screenTrack.onended = () => stopScreenShare()
      setLocalScreenStream(screenStream)
      setIsScreenSharing(true)
      addTrackToScreenConnections(screenTrack, screenStream)
      socketRef.current?.emit('state-update', { sharingScreen: true })
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setMediaError(describeMediaError(err))
      }
    }
  }, [addTrackToScreenConnections, stopScreenShare])

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) stopScreenShare()
    else startScreenShare()
  }, [isScreenSharing, startScreenShare, stopScreenShare])

  const handleLogin = (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setIsLoggingIn(true)
    setLoginError(null)

    const tempSocket = io(SERVER_URL)
    tempSocket.on('connect', () => {
      tempSocket.emit('login', { username: username.trim(), password }, (response) => {
        tempSocket.disconnect()
        setIsLoggingIn(false)
        if (response?.success) {
          setUsername(response.username)
          setSessionToken(response.token)
          if (Array.isArray(response.iceServers) && response.iceServers.length > 0) {
            setIceServers(response.iceServers)
          }
          setChannels(Array.isArray(response.channels) ? response.channels : [])
          setLoggedIn(true)
        } else {
          setLoginError(response?.message || 'Giriş başarısız.')
        }
      })
    })
    tempSocket.on('connect_error', () => {
      setIsLoggingIn(false)
      setLoginError('Sunucuya bağlanılamadı.')
      tempSocket.disconnect()
    })
  }

  const handleChannelPasswordSubmit = (e) => {
    e.preventDefault()
    if (pendingChannel) {
      joinChannel(pendingChannel, channelPasswordInput)
    }
    setPendingChannel(null)
    setShowChannelPassword(false)
    setChannelPasswordInput('')
  }

  const handleSendMessage = (e) => {
    e.preventDefault()
    const text = chatInput.trim()
    if (!text || !socketRef.current) return
    socketRef.current.emit('send-message', { token: sessionTokenRef.current, text })
    setChatInput('')
  }

  const handleLoadOlderMessages = () => {
    if (!socketRef.current || messages.length === 0 || isLoadingOlder) return
    setIsLoadingOlder(true)
    const container = chatMessagesRef.current
    const previousScrollHeight = container ? container.scrollHeight : 0

    socketRef.current.emit(
      'load-older-messages',
      { token: sessionTokenRef.current, before: messages[0].createdAt },
      (response) => {
        const older = response?.messages || []
        setMessages((prev) => [...older, ...prev])
        setHasMoreHistory(older.length >= 50)
        setIsLoadingOlder(false)
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - previousScrollHeight
          }
        })
      }
    )
  }

  if (!loggedIn) {
    return (
      <div className="name-entry">
        <h1>Sesli Sohbet</h1>
        <p>Hesabınla giriş yap:</p>
        <form onSubmit={handleLogin}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Kullanıcı adı"
            autoFocus
          />
          <div className="password-field-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre"
            />
            <button
              type="button"
              className="password-toggle-button"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              title={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
            >
              <EyeIcon visible={showPassword} />
            </button>
          </div>
          <button type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
        {loginError && <p className="error-text">{loginError}</p>}
        <p className="name-entry-hint">
          Hesabın yoksa, grubu kuran kişiden hesap açmasını isteyebilirsin.
        </p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="channel-sidebar">
        <h1 className="app-title">Sesli Sohbet</h1>
        <p className="whoami">{displayName} olarak bağlısın</p>
        <nav className="channel-list">
          {channels.map((channel) => (
            <button
              key={channel}
              className={
                'channel-button' + (activeChannel === channel ? ' channel-button--active' : '')
              }
              onClick={() => {
                setPendingChannel(channel)
                setChannelPasswordInput('')
              }}
            >
              # {channel}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        {connectionError && <p className="error-text">{connectionError}</p>}

        {!activeChannel && !connectionError && <p>Başlamak için soldan bir kanal seç.</p>}

        {activeChannel && !connectionError && (
          <div className="channel-view">
            {connectionStatus === 'reconnecting' && (
              <div className="reconnecting-banner">🔄 Bağlantı koptu, yeniden bağlanılıyor…</div>
            )}

            <div className="channel-main">
              <div className="channel-header">
                <h2># {activeChannel}</h2>
                <div className="channel-header-actions">
                  {!inVoice ? (
                    <button className="join-voice-button" onClick={joinVoice}>
                      📞 Sese Katıl
                    </button>
                  ) : (
                    <button className="leave-voice-button" onClick={leaveVoice}>
                      📞 Sesten Çık
                    </button>
                  )}
                  <button className="leave-button" onClick={leaveChannel}>
                    Kanaldan Ayrıl
                  </button>
                </div>
              </div>

              {inVoice && (
                <div className={'video-grid' + (enlargedTile ? ' video-grid--has-enlarged' : '')}>
                  {mediaError && <p className="error-text">{mediaError}</p>}

                  <div
                    className={
                      'video-tile local-media-panel' +
                      (enlargedTile === 'local-camera' ? ' video-tile--enlarged' : '')
                    }
                    onClick={() => toggleEnlarge('local-camera')}
                  >
                    {isCameraOn ? (
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="local-video"
                      />
                    ) : (
                      <div className="camera-off-placeholder">
                        <div className="avatar-circle">{displayName.charAt(0).toUpperCase()}</div>
                      </div>
                    )}
                    <div className="media-controls" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={'control-button' + (isMicOn ? '' : ' control-button--off')}
                        onClick={pttEnabled ? undefined : toggleMic}
                        disabled={pttEnabled}
                        title={
                          pttEnabled
                            ? `Bas-konuş açık (${formatKeyCode(pttKey)}) — konuşmak için tuşu basılı tut`
                            : isMicOn
                              ? 'Mikrofonu kapat'
                              : 'Mikrofonu aç'
                        }
                      >
                        {isMicOn ? '🎤' : '🔇'}
                      </button>
                      <button
                        className={'control-button' + (isCameraOn ? '' : ' control-button--off')}
                        onClick={toggleCamera}
                        title={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
                      >
                        {isCameraOn ? '🎥' : '📷'}
                      </button>
                      <button
                        className={
                          'control-button' + (isScreenSharing ? '' : ' control-button--off')
                        }
                        onClick={toggleScreenShare}
                        title={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
                      >
                        {isScreenSharing ? '🛑' : '🖥️'}
                      </button>
                      {/* YENİ: Bas-konuş ayarla/kapat. */}
                      <button
                        className={
                          'control-button' + (pttEnabled ? ' control-button--ptt-active' : '')
                        }
                        onClick={handleTogglePtt}
                        title={
                          pttEnabled
                            ? `Bas-konuş: ${formatKeyCode(pttKey)} — kapatmak için tıkla`
                            : 'Bas-konuş ayarla'
                        }
                      >
                        🎯
                      </button>
                    </div>
                    {isCapturingPttKey && (
                      <p className="ptt-capture-hint">Bas-konuş için bir tuşa bas…</p>
                    )}
                  </div>

                  {isScreenSharing && (
                    <div
                      className={
                        'video-tile local-media-panel' +
                        (enlargedTile === 'local-screen' ? ' video-tile--enlarged' : '')
                      }
                      onClick={() => toggleEnlarge('local-screen')}
                    >
                      <video
                        ref={localScreenVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="local-video local-video--screen"
                      />
                      <span className="remote-video-label">Ekranın (sen)</span>
                    </div>
                  )}

                  {Object.entries(remoteStreams).map(([socketId, streams]) => {
                    const peer = peers.find((p) => p.socketId === socketId)
                    const label = peer ? peer.username : '...'
                    return (
                      <div key={socketId} className="peer-tiles-group">
                        {streams.mainStream && (
                          <RemoteCameraTile
                            stream={streams.mainStream}
                            label={label}
                            cameraOn={peer ? peer.cameraOn : false}
                            micOn={peer ? !peer.muted : false}
                            isEnlarged={enlargedTile === `${socketId}-camera`}
                            onToggleEnlarge={() => toggleEnlarge(`${socketId}-camera`)}
                            volume={peerVolumes[socketId] ?? 100}
                            onVolumeChange={(percent) => setPeerVolume(socketId, percent)}
                            showVolumeMenu={volumeMenuFor === socketId}
                            onOpenVolumeMenu={() => setVolumeMenuFor(socketId)}
                            onCloseVolumeMenu={() => setVolumeMenuFor(null)}
                          />
                        )}
                        {peer?.sharingScreen && streams.screenStream && (
                          <RemoteScreenTile
                            stream={streams.screenStream}
                            label={label}
                            isEnlarged={enlargedTile === `${socketId}-screen`}
                            onToggleEnlarge={() => toggleEnlarge(`${socketId}-screen`)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="chat-panel">
                <div className="chat-messages" ref={chatMessagesRef}>
                  {messages.length === 0 && (
                    <p className="chat-empty-hint">Henüz mesaj yok, ilk mesajı sen at.</p>
                  )}
                  {messages.length > 0 && hasMoreHistory && (
                    <button
                      type="button"
                      className="chat-load-older"
                      onClick={handleLoadOlderMessages}
                      disabled={isLoadingOlder}
                    >
                      {isLoadingOlder ? 'Yükleniyor…' : 'Daha eski mesajları göster'}
                    </button>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i} className="chat-message">
                      <span className="chat-message-author">{msg.username}</span>
                      <span className="chat-message-text">{msg.text}</span>
                    </div>
                  ))}
                </div>
                <form className="chat-input-form" onSubmit={handleSendMessage}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Mesaj yaz…"
                    maxLength={2000}
                  />
                  <button type="submit">Gönder</button>
                </form>
              </div>
            </div>

            {/* YENİ: Discord tarzı üye listesi — online (seste olanlar
                işaretli) + offline (daha önce burada olmuş ama şu an
                bağlı olmayanlar). */}
            <aside className="member-list-panel">
              <div className="member-list-section">
                <h3>Çevrimiçi — {onlineMembers.length}</h3>
                <ul>
                  {onlineMembers.map((m) => (
                    <li key={m.username} className="member-item member-item--online">
                      <span className="member-status-dot member-status-dot--online" />
                      {m.username} {m.inVoice && '🎙️'}
                    </li>
                  ))}
                </ul>
              </div>
              {offlineMembers.length > 0 && (
                <div className="member-list-section">
                  <h3>Çevrimdışı — {offlineMembers.length}</h3>
                  <ul>
                    {offlineMembers.map((m) => (
                      <li key={m.username} className="member-item member-item--offline">
                        <span className="member-status-dot member-status-dot--offline" />
                        {m.username}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>

      {pendingChannel && (
        <div className="screen-picker-overlay">
          <div className="screen-picker-modal channel-password-modal">
            <h2># {pendingChannel} şifresi</h2>
            <form onSubmit={handleChannelPasswordSubmit}>
              <div className="password-field-wrapper">
                <input
                  type={showChannelPassword ? 'text' : 'password'}
                  value={channelPasswordInput}
                  onChange={(e) => setChannelPasswordInput(e.target.value)}
                  placeholder="Kanal şifresi"
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle-button"
                  onClick={() => setShowChannelPassword((prev) => !prev)}
                  tabIndex={-1}
                  title={showChannelPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                >
                  <EyeIcon visible={showChannelPassword} />
                </button>
              </div>
              <div className="channel-password-actions">
                <button type="submit">Katıl</button>
                <button
                  type="button"
                  className="screen-picker-cancel"
                  onClick={() => {
                    setPendingChannel(null)
    setShowChannelPassword(false)
                    setChannelPasswordInput('')
                  }}
                >
                  İptal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
