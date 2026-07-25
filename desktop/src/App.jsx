import { useState, useRef, useCallback, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const SERVER_URL = 'https://proje-dh7l.onrender.com'
const CHANNELS = ['Genel', 'Oyun', 'Müzik']

// YENİ: TURN bilgileri artık koda GÖMÜLMÜYOR — sunucudan, girişten
// (login) sonra geliyor. Bu, giriş yapılana kadar kullanılacak
// varsayılan (sadece STUN) liste.
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

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
function RemoteCameraTile({ stream, label, cameraOn, micOn }) {
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
    <div className="remote-video-wrapper">
      {cameraOn ? (
        <video ref={videoRef} autoPlay playsInline className="remote-video" />
      ) : (
        <div className="camera-off-placeholder camera-off-placeholder--small">
          <div className="avatar-circle avatar-circle--small">
            {label.charAt(0).toUpperCase()}
          </div>
          <audio ref={audioRef} autoPlay />
        </div>
      )}
      <span className="remote-video-label">
        {label} {!micOn && '🔇'}
      </span>
    </div>
  )
}

// YENİ: Karşı tarafın EKRAN paylaşımı — kameradan tamamen AYRI, kendi
// kutucuğu. Sadece o kişi paylaşım yapıyorken render ediliyor.
function RemoteScreenTile({ stream, label }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="remote-video-wrapper">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="remote-video remote-video--screen"
      />
      <span className="remote-video-label">{label} 🖥️ ekranı</span>
    </div>
  )
}

function App() {
  // --- YENİ: kişisel hesap girişi (isim yerine kullanıcı adı+şifre) ---
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const displayName = username // Girişi yapan kişinin doğrulanmış adı.

  // YENİ: sunucudan (login sonrası) gelen ICE sunucu listesi — TURN
  // bilgilerini içeriyor ama koda hiç gömülü değil.
  const [iceServers, setIceServers] = useState(DEFAULT_ICE_SERVERS)
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS)
  useEffect(() => {
    iceServersRef.current = iceServers
  }, [iceServers])

  // --- YENİ: hangi kanala girmek istediğimiz, şifresini sorarken ---
  const [pendingChannel, setPendingChannel] = useState(null)
  const [channelPasswordInput, setChannelPasswordInput] = useState('')

  const [activeChannel, setActiveChannel] = useState(null)
  const [peers, setPeers] = useState([])
  const [connectionError, setConnectionError] = useState(null)
  const [mediaError, setMediaError] = useState(null)
  // YENİ: bağlantı kopması/yeniden bağlanma durumunu takip ediyoruz —
  // artık kullanıcıya sessizce değil, görünür bir şekilde bildiriyoruz.
  const [connectionStatus, setConnectionStatus] = useState('connected')

  // --- Mikrofon + kamera (ana bağlantı) ---
  const [localMainStream, setLocalMainStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isCameraOn, setIsCameraOn] = useState(false)

  // --- YENİ: Ekran paylaşımı artık TAMAMEN AYRI bir akış/bağlantı ---
  const [localScreenStream, setLocalScreenStream] = useState(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  // remoteStreams artık kişi başına { mainStream, screenStream } tutuyor.
  const [remoteStreams, setRemoteStreams] = useState({})

  const [screenSourceOptions, setScreenSourceOptions] = useState(null)

  const socketRef = useRef(null)
  const localVideoRef = useRef(null)
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
  // screenPc, ekran paylaşımı fiilen başlayana kadar null kalır (tembel
  // kurulum) — herkesle "boşuna" ikinci bir bağlantı açmaya gerek yok.
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

  // connectionType: 'main' | 'screen' — hangi alt bağlantıdan geldiğini
  // bilmemiz lazım ki doğru kutuya (mainStream/screenStream) yazalım.
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
      return {
        ...prev,
        [peerSocketId]: { ...peerEntry, [streamKey]: existing },
      }
    })
  }, [])

  // Tek bir alt bağlantının (main YA DA screen) ortak kurulum mantığı —
  // olay dinleyicileri, teklif gönderme vs. connectionType parametresiyle
  // hangi türden bahsettiğimizi biliyor (sinyal mesajlarına ekliyoruz).
  const createSubConnection = useCallback(
    (peerSocketId, connectionType) => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })

      pc.ontrack = (event) => {
        console.log(
          `[WebRTC ${peerSocketId}/${connectionType}] ontrack: kind=${event.track.kind}`
        )
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

      // Çakışan müzakereleri önleyen kilit (daha önce eklediğimiz mantığın
      // aynısı, artık her alt bağlantı için ayrı ayrı geçerli).
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

  // "Ana" (mikrofon+kamera) bağlantıyı bulur, yoksa kurar. Kurulurken
  // baştan bir ses+görüntü yuvası açıyoruz (recvonly) ki karşı taraf
  // medya olsun olmasın hemen bir kutucuk görsün — bu, önceden test edip
  // sağlamlaştırdığımız, güvendiğimiz desen.
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

  // "Ekran" bağlantısı TAMAMEN TEMBEL — sadece gerçekten ihtiyaç olduğunda
  // (biri paylaşım başlattığında) kuruluyor, baştan boş yuva açmıyoruz.
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

  // Eksik ANA bağlantıları (hata sonrası temizlenmiş olabilir) otomatik
  // yeniden kuran kendi kendini toparlama mantığı.
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

  // YENİ: Ekran track'ini TÜM akranlara — her biri için gerekirse
  // screenPc'yi SIFIRDAN kuruyor (ensureMainConnections'ın ekran karşılığı).
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
      if (sender) {
        entry.screenPc.removeTrack(sender)
      }
      entry.screenPc.close()
      entry.screenPc = null
      console.log(`[screen] ${peerSocketId} - ekran bağlantısı kapatıldı`)

      // SADECE bu kişinin ekran akışını temizliyoruz — diğer kişilerin
      // (varsa) kendi ekran paylaşımlarına dokunmuyoruz.
      setRemoteStreams((prev) => {
        const peerEntry = prev[peerSocketId]
        if (!peerEntry) return prev
        return { ...prev, [peerSocketId]: { ...peerEntry, screenStream: undefined } }
      })
    })
  }, [])

  const leaveChannel = useCallback(() => {
    cleanupSocket()
    stopLocalMedia()
    cleanupPeerConnections()
    setPeers([])
    setConnectionError(null)
    setMediaError(null)
    setIsMicOn(false)
    setIsCameraOn(false)
    setIsScreenSharing(false)
    setConnectionStatus('connected')
    setActiveChannel(null)
  }, [cleanupSocket, stopLocalMedia, cleanupPeerConnections])

  const joinChannel = useCallback(
    (channelName, channelSecret) => {
      cleanupSocket()
      stopLocalMedia()
      cleanupPeerConnections()
      setPeers([])
      setConnectionError(null)
      setMediaError(null)
      setIsMicOn(false)
      setIsCameraOn(false)
      setIsScreenSharing(false)
      setConnectionStatus('connected')
      setActiveChannel(channelName)

      const socket = io(SERVER_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        // "connect" olayı hem ilk bağlantıda hem de kopma sonrası
        // YENİDEN bağlanmada tetikleniyor — ikisinde de odaya (tekrar)
        // katılmamız lazım, Socket.io/sunucu bunu hatırlamıyor.
        setConnectionStatus('connected')
        socket.emit('join-room', { roomId: channelName, displayName, secret: channelSecret })
      })

      // YENİ: bağlantı koparsa (wifi kesintisi, sunucu yeniden başlaması
      // vb.) kullanıcıya GÖRÜNÜR bir şekilde bildiriyoruz. Socket.io
      // varsayılan olarak arka planda kendiliğinden yeniden bağlanmayı
      // dener — biz sadece bunu görünür kılıyoruz.
      socket.on('disconnect', () => {
        setConnectionStatus('reconnecting')
      })

      socket.on('existing-users', (users) => {
        setPeers(users)
      })

      socket.on('user-joined', (user) => {
        setPeers((prev) => [...prev, user])
        // Yeni katılan için hemen ANA bağlantıyı kuruyoruz (kutucuk
        // görünsün diye) — ekran bağlantısı tembel, gerekince kurulacak.
        getOrCreateMainConnection(user.socketId)
      })

      socket.on('user-left', ({ socketId }) => {
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
        setPeers((prev) =>
          prev.map((p) => (p.socketId === socketId ? { ...p, ...state } : p))
        )
      })

      // YENİ (güvenlik): sunucu şifreyi reddederse, kanaldan çıkıp
      // kullanıcıya net bir hata gösteriyoruz.
      socket.on('join-error', (message) => {
        setConnectionError(message || 'Odaya katılamadın.')
        cleanupSocket()
        setActiveChannel(null)
      })

      socket.on('connect_error', () => {
        setConnectionError(
          'Sunucuya bağlanılamadı. Sinyalleşme sunucusunun (server klasörü) çalıştığından emin ol.'
        )
      })
    },
    [
      cleanupSocket,
      stopLocalMedia,
      cleanupPeerConnections,
      getOrCreateMainConnection,
      getOrCreateScreenConnection,
      syncReceiversToStream,
      displayName,
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

  const toggleMic = useCallback(async () => {
    const existingAudioTrack = localMainStream?.getAudioTracks()[0]

    if (!existingAudioTrack) {
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

    const newEnabled = !existingAudioTrack.enabled
    existingAudioTrack.enabled = newEnabled
    setIsMicOn(newEnabled)
    socketRef.current?.emit('state-update', { muted: !newEnabled })
  }, [localMainStream, addTrackToMainConnections])

  // YENİ: Kamera artık ekran paylaşımından TAMAMEN BAĞIMSIZ — ikisi
  // aynı anda açık kalabilir.
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

  // YENİ: Ekran paylaşımı artık TAMAMEN KENDİ akışında/bağlantısında —
  // kamerayı hatırlama/geri dönme mantığına hiç gerek yok, çünkü kamerayı
  // hiç etkilemiyor.
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
      screenTrack.onended = () => {
        stopScreenShare()
      }
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
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      startScreenShare()
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare])

  const handleLogin = (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setIsLoggingIn(true)
    setLoginError(null)

    // Giriş kontrolü için GEÇİCİ bir bağlantı — kanal bağlantılarından
    // tamamen ayrı, sadece "bu kullanıcı adı/şifre doğru mu" sorusunu
    // sorup cevabı alınca kapanıyor.
    const tempSocket = io(SERVER_URL)
    tempSocket.on('connect', () => {
      tempSocket.emit('login', { username: username.trim(), password }, (response) => {
        tempSocket.disconnect()
        setIsLoggingIn(false)
        if (response?.success) {
          setUsername(response.username)
          if (Array.isArray(response.iceServers) && response.iceServers.length > 0) {
            setIceServers(response.iceServers)
          }
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
    setChannelPasswordInput('')
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Şifre"
          />
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
          {CHANNELS.map((channel) => (
            <button
              key={channel}
              className={
                'channel-button' +
                (activeChannel === channel ? ' channel-button--active' : '')
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

        {!activeChannel && !connectionError && (
          <p>Başlamak için soldan bir kanal seç.</p>
        )}

        {activeChannel && !connectionError && (
          <div className="channel-view">
            {connectionStatus === 'reconnecting' && (
              <div className="reconnecting-banner">
                🔄 Bağlantı koptu, yeniden bağlanılıyor…
              </div>
            )}
            <div className="peer-panel">
              <div className="peer-panel-header">
                <h2># {activeChannel}</h2>
                <button className="leave-button" onClick={leaveChannel}>
                  Ayrıl
                </button>
              </div>
              <p>Odadakiler ({peers.length + 1}):</p>
              <ul className="peer-list">
                <li>
                  {displayName} (sen) {!isMicOn && '🔇'} {!isCameraOn && '📷'}{' '}
                  {isScreenSharing && '🖥️'}
                </li>
                {peers.map((p) => (
                  <li key={p.socketId}>
                    {p.displayName} {p.muted && '🔇'} {!p.cameraOn && '📷'}{' '}
                    {p.sharingScreen && '🖥️'}
                  </li>
                ))}
              </ul>
            </div>

            <div className="video-grid">
              <div className="local-media-panel">
                {mediaError && <p className="error-text">{mediaError}</p>}

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
                      'control-button' + (isCameraOn ? '' : ' control-button--off')
                    }
                    onClick={toggleCamera}
                    title={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
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

              {/* YENİ: kendi ekran paylaşımın için AYRI kutucuk — sadece
                  paylaşırken görünür. */}
              {isScreenSharing && (
                <div className="local-media-panel">
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
                const label = peer ? peer.displayName : '...'
                return (
                  <div key={socketId} className="peer-tiles-group">
                    {streams.mainStream && (
                      <RemoteCameraTile
                        stream={streams.mainStream}
                        label={label}
                        cameraOn={peer ? peer.cameraOn : false}
                        micOn={peer ? !peer.muted : false}
                      />
                    )}
                    {peer?.sharingScreen && streams.screenStream && (
                      <RemoteScreenTile stream={streams.screenStream} label={label} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* YENİ: Kanal şifresi sorma penceresi — bir kanala tıklayınca açılır. */}
      {pendingChannel && (
        <div className="screen-picker-overlay">
          <div className="screen-picker-modal channel-password-modal">
            <h2># {pendingChannel} şifresi</h2>
            <form onSubmit={handleChannelPasswordSubmit}>
              <input
                type="password"
                value={channelPasswordInput}
                onChange={(e) => setChannelPasswordInput(e.target.value)}
                placeholder="Kanal şifresi"
                autoFocus
              />
              <div className="channel-password-actions">
                <button type="submit">Katıl</button>
                <button
                  type="button"
                  className="screen-picker-cancel"
                  onClick={() => {
                    setPendingChannel(null)
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
