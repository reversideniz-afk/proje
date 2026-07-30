import { useState, useRef, useCallback, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'
import logoUrl from './assets/logo.png'

const SERVER_URL = 'https://proje-dh7l.onrender.com'
// YENİ: Mesaj tepkileri için hızlı seçim listesi.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

// YENİ: TURN bilgileri koda GÖMÜLMÜYOR — girişten sonra sunucudan geliyor.
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// YENİ: Renk temaları — her biri sadece App.css'teki :root[data-theme]
// bloğuyla eşleşen bir kimlik + önizleme rengi. Yeni bir tema eklemek
// istersen: App.css'e bir blok, buraya bir satır eklemen yeterli.
const THEMES = [
  { id: 'mercan', label: 'Mercan', color: '#f2726c' },
  { id: 'mor', label: 'Mor', color: '#a374f2' },
  { id: 'mavi', label: 'Mavi', color: '#5b9bf2' },
  { id: 'yesil', label: 'Yeşil', color: '#4caf7d' },
  { id: 'amber', label: 'Amber', color: '#e0a940' },
  { id: 'pembe', label: 'Pembe', color: '#f26ca3' },
]

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

// YENİ: Mesaj saatini okunabilir göstermek için.
function formatMessageTime(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// YENİ: Birisi @kullanıcıadı ile bahsedildiğinde çalınan kısa, nazik
// bir "ping" sesi — dışarıdan bir ses dosyası eklemeye gerek kalmasın
// diye programatik olarak (Web Audio API ile) üretiliyor.
// YENİ: Tüm ses efektlerinin ortak temeli — dışarıdan ses dosyası
// eklemeden (Web Audio API ile üreterek), belirli bir frekans/süre/
// dalga tipinde kısa bir ton çalar.
function playTone(ctx, frequency, startOffset, duration, gainValue = 0.12, type = 'sine') {
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.type = type
  oscillator.frequency.value = frequency
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)
  const startTime = ctx.currentTime + startOffset
  gainNode.gain.setValueAtTime(gainValue, startTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
  oscillator.start(startTime)
  oscillator.stop(startTime + duration)
}

function withAudioContext(fn) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    fn(ctx)
  } catch {
    // Ses opsiyonel bir özellik — başarısız olursa sessizce geç.
  }
}

// Birisi @kullanıcıadımla bahsettiğinde.
function playMentionSound() {
  withAudioContext((ctx) => playTone(ctx, 880, 0, 0.3, 0.15))
}

// YENİ: Biri sese katıldığında — yükselen, "hoş geldin" hissi veren iki nota.
function playJoinSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 523.25, 0, 0.12, 0.1) // Do
    playTone(ctx, 659.25, 0.08, 0.16, 0.1) // Mi
  })
}

// YENİ: Biri sesten ayrıldığında — alçalan iki nota.
function playLeaveSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 659.25, 0, 0.12, 0.1) // Mi
    playTone(ctx, 523.25, 0.08, 0.16, 0.1) // Do
  })
}

// YENİ: Yeni bir mesaj geldiğinde — kısa, nazik bir "tık".
function playMessageSound() {
  withAudioContext((ctx) => playTone(ctx, 700, 0, 0.09, 0.07))
}

// YENİ: Biri (ya da sen) ekran paylaşımını başlattığında — farklı bir
// tını (üçgen dalga) ile ayırt edilebilir olsun diye.
function playScreenShareSound() {
  withAudioContext((ctx) => {
    playTone(ctx, 440, 0, 0.1, 0.1, 'triangle')
    playTone(ctx, 880, 0.07, 0.14, 0.1, 'triangle')
  })
}

// YENİ: Mesaj metnindeki @kullanıcıadı bahsetmelerini vurgulu göster.
// Beni (myUsername) bahsedenler ayrıca özel renkte.
function renderMessageTextWithMentions(text, myUsername) {
  const parts = text.split(/(@[\wÇĞİÖŞÜçğıöşü]+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      // YENİ: "@all" herkese yönelik özel bir etiket — kendi adın gibi
      // vurgulanıyor, çünkü bu mesaj SANA (ve herkese) yönelik.
      const isAll = part.toLowerCase() === '@all'
      const isMe = isAll || (myUsername && part.slice(1).toLowerCase() === myUsername.toLowerCase())
      return (
        <span key={i} className={'mention' + (isMe ? ' mention--me' : '')}>
          {part}
        </span>
      )
    }
    return part
  })
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

// Karşı tarafın EKRAN paylaşımı — kameradan ayrı, kendi kutucuğu.
// NOT: bu kutucuğun sesi (varsa) mikrofon sesi gibi Web Audio üzerinden
// DEĞİL, doğrudan bu <video> elemanı üzerinden çalıyor — bu yüzden
// kullanıcının seçtiği çıkış cihazını (outputDeviceId) ayrıca burada da
// setSinkId ile uygulamamız gerekiyor, yoksa hep sistem varsayılanına gider.
function RemoteScreenTile({ stream, label, isEnlarged, onToggleEnlarge, outputDeviceId }) {
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

// YENİ: her ekranda (giriş dahil) sabit köşede duran küçük yakınlaştırma
// kontrolü — Ctrl+/Ctrl- ile aynı işi yapar, sadece tıklanabilir hali.
function ZoomControl({ zoomLevel, onZoomOut, onZoomIn, onReset, isFullscreen, onToggleFullscreen }) {
  return (
    <div className="zoom-control">
      <button onClick={onZoomOut} title="Küçült (Ctrl -)">
        −
      </button>
      <span onClick={onReset} title="Sıfırla (Ctrl 0)">
        {Math.round(zoomLevel * 100)}%
      </span>
      <button onClick={onZoomIn} title="Büyüt (Ctrl +)">
        +
      </button>
      {/* YENİ: tek tuşla çerçevesiz tam ekran. */}
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran yap'}
        >
          {isFullscreen ? '⤢' : '⛶'}
        </button>
      )}
    </div>
  )
}

function App() {
  // YENİ: Arayüz yakınlaştırma — tüm pencereyi büyütüp küçültüyor.
  // Son seçilen seviye, uygulama kapanıp açılsa bile hatırlanıyor.
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = window.localStorage?.getItem('zoomLevel')
    const parsed = saved ? parseFloat(saved) : 1
    return Number.isFinite(parsed) ? parsed : 1
  })

  useEffect(() => {
    window.electronAPI?.setZoomFactor?.(zoomLevel)
    window.localStorage?.setItem('zoomLevel', String(zoomLevel))
  }, [zoomLevel])

  const zoomIn = () => setZoomLevel((z) => Math.min(Math.round((z + 0.1) * 10) / 10, 1.8))
  const zoomOut = () => setZoomLevel((z) => Math.max(Math.round((z - 0.1) * 10) / 10, 0.6))
  const zoomReset = () => setZoomLevel(1)

  // Ctrl+ / Ctrl- / Ctrl+0 (Mac'te Cmd) — standart yakınlaştırma kısayolları.
  useEffect(() => {
    const handleKeydown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        zoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        zoomReset()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  // YENİ: tek tuşla çerçevesiz tam ekran — gerçek pencere durumu main
  // process'te (bkz. electron/main.cjs) olduğu için IPC üzerinden okuyup
  // dinliyoruz; F11 gibi başka bir yoldan da değişse (ya da pencere
  // dışarıdan tam ekrandan çıkarılsa) düğmenin ikonu güncel kalsın diye.
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    window.electronAPI?.isFullscreen?.().then((value) => {
      if (typeof value === 'boolean') setIsFullscreen(value)
    })
    const unsubscribe = window.electronAPI?.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [])
  const toggleFullscreen = () => window.electronAPI?.toggleFullscreen?.()

  // YENİ: Renk teması — herkes kendi zevkine göre bir vurgu rengi
  // seçebilsin diye. Sadece CSS değişkenlerini değiştiriyor (bkz.
  // App.css :root[data-theme=...]), tüm arayüz otomatik uyum sağlıyor.
  // Seçim cihazda kalıcı (localStorage) — hesaba değil, bu bilgisayara
  // bağlı bir tercih.
  const [theme, setTheme] = useState(() => window.localStorage?.getItem('theme') || 'mercan')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage?.setItem('theme', theme)
  }, [theme])
  // YENİ: kalıcı, kanalların hizasındaki genel ayarlar paneli — şimdilik
  // sadece kişiselleştirme (tema) var, ileride büyüyebilir diye ayrı bir
  // panel olarak kurduk (sesteki cihaz ayarlarından bağımsız).
  const [showAppSettings, setShowAppSettings] = useState(false)

  // YENİ: Alganis rolü için uygulama içi üye/rol yönetimi — Ayarlar
  // panelinin bir bölümü, sadece isAdmin true iken görünüyor.
  const [allUsers, setAllUsers] = useState([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [userManagementError, setUserManagementError] = useState(null)
  const [roleInputByUser, setRoleInputByUser] = useState({}) // username -> yazılmakta olan yeni rol

  // --- Kişisel hesap girişi ---
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const displayName = username

  // YENİ: Davet kodlu kayıt — giriş ekranında "Kayıt ol" moduna
  // geçilebiliyor. Kullanıcı adı/şifre alanları login ile PAYLAŞILIYOR,
  // sadece davet kodu ekstra.
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register'
  const [inviteCode, setInviteCode] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [registerError, setRegisterError] = useState(null)
  const [registerSuccessMessage, setRegisterSuccessMessage] = useState(null)

  // YENİ: kendi rollerim — sadece arayüzde admin panelini gösterip
  // göstermemeye karar vermek için. Gerçek yetki kontrolü HER ZAMAN
  // sunucuda taze bir DB okumasıyla tekrar yapılıyor.
  const [myRoles, setMyRoles] = useState([])
  const isAdmin = myRoles.includes('Alganis')

  // YENİ: Profil fotoğrafı — girişte sunucudan gelir, ayarlardan
  // değiştirilince 'avatar-saved' ile güncellenir.
  const [myAvatar, setMyAvatar] = useState(null)
  const [avatarUploadError, setAvatarUploadError] = useState(null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)

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

  // YENİ: kanal listesi artık sunucudan geliyor (koda gömülü değil) —
  // ve artık SADECE erişimi olan kanallar geliyor (rol tabanlı erişim).
  const [channels, setChannels] = useState([])

  // --- Kanal (metin) durumu ---
  const [activeChannel, setActiveChannel] = useState(null)
  const activeChannelRef = useRef(null)
  useEffect(() => {
    activeChannelRef.current = activeChannel
  }, [activeChannel])
  // YENİ: hangi kanalın METNİNİ görüntülediğin (activeChannel) ile hangi
  // kanalın SESİNDE olduğun (voiceChannel) artık AYRI şeyler — sesteyken
  // başka bir kanala göz atıp mesaj okuyabilesin diye. voiceChannel, sesten
  // çıkana kadar sabit kalır; activeChannel istediğin kadar değişebilir.
  const [voiceChannel, setVoiceChannel] = useState(null)
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
  // YENİ: fotoğraflar — WhatsApp'ın "tek seferlik" fotoğrafı gibi,
  // HİÇBİR YERE kaydedilmiyor. Bu yüzden mesajlardan (messages) AYRI,
  // sadece bu oturumda tutulan bir liste — kanaldan çıkıp girince,
  // ya da geçmiş mesaj yüklenince buraya hiç dokunulmuyor.
  const [ephemeralPhotos, setEphemeralPhotos] = useState([])
  const [isSendingPhoto, setIsSendingPhoto] = useState(false)
  const photoFileInputRef = useRef(null)
  const chatInputRef = useRef(null)
  const avatarFileInputRef = useRef(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  // YENİ: o an aktif kanalda kimlerin yazıyor olduğu.
  const [typingUsers, setTypingUsers] = useState([])
  const isTypingRef = useRef(false)
  const typingStopTimeoutRef = useRef(null)
  // YENİ: hangi kanallarda (SADECE üye olunanlarda — sunucu zaten
  // sadece üyelere bildirim gönderiyor) okunmamış aktivite var.
  const [unreadChannels, setUnreadChannels] = useState([])
  // YENİ: sohbet üstüne dosya sürüklenirken görsel ipucu için.
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false)

  // --- Mikrofon + kamera (ana bağlantı) ---
  const [localMainStream, setLocalMainStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)

  // YENİ: Ses giriş/çıkış cihazı seçimi — hangi mikrofonu/hoparlörü
  // kullanacağını seçebilesin diye. Seçim kalıcı (uygulamayı kapatıp
  // açsan bile hatırlanır).
  const [audioInputs, setAudioInputs] = useState([])
  const [audioOutputs, setAudioOutputs] = useState([])
  const [selectedAudioInput, setSelectedAudioInput] = useState(
    () => window.localStorage?.getItem('audioInputId') || ''
  )
  const [selectedAudioOutput, setSelectedAudioOutput] = useState(
    () => window.localStorage?.getItem('audioOutputId') || ''
  )
  const [outputDeviceError, setOutputDeviceError] = useState(null)
  // AudioContext bir REF içinde yaşıyor (bkz. audioContextRef, aşağıda) —
  // yani oluşturulduğu an React bunu "state değişti" diye algılamıyor.
  // Seçili çıkış cihazını context'in gerçek yaratılış anında da
  // uygulayabilmek için (bkz. getAudioContext) güncel değeri bu ref'te
  // tutuyoruz.
  const selectedAudioOutputRef = useRef(selectedAudioOutput)

  const refreshAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioInputs(devices.filter((d) => d.kind === 'audioinput'))
      setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'))
    } catch {
      // Cihaz listesi alınamazsa sessizce geç — seçim kutusu boş kalır.
    }
  }, [])

  useEffect(() => {
    refreshAudioDevices()
    // Cihaz etiketleri (isimleri), mikrofon izni verilene kadar genelde
    // BOŞ görünür (tarayıcı gizliliği) — izin verildikten sonra ve bir
    // cihaz takılıp çıkarıldığında listeyi tazeliyoruz.
    navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshAudioDevices)
  }, [refreshAudioDevices])

  // DÜZELTME: localStorage'da eskiden kaydedilmiş bir çıkış cihazı ID'si,
  // artık bu makinede GERÇEKTEN var olan cihazlardan biri olmayabilir
  // (sürücü güncellemesi, sanal ses cihazı yeniden kurulumu — ör.
  // SteelSeries Sonar gibi sanal ses araçları ID'leri değiştirebiliyor).
  // Böyle "hayalet" bir ID'ye setSinkId çağırmak ya sessizce başarısız
  // olur ya da var olmayan bir cihaza "başarılı" şekilde bağlanıp sesi
  // hiçbir yere çalmaz. Liste geldiğinde seçili ID artık listede yoksa,
  // otomatik olarak varsayılana dönüyoruz.
  useEffect(() => {
    if (!selectedAudioOutput || audioOutputs.length === 0) return
    const stillExists = audioOutputs.some((d) => d.deviceId === selectedAudioOutput)
    if (!stillExists) {
      console.warn(
        '[ses çıkışı] Kayıtlı çıkış cihazı artık bu bilgisayarda yok, varsayılana dönülüyor:',
        selectedAudioOutput
      )
      setSelectedAudioOutput('')
      setOutputDeviceError(
        'Daha önce seçtiğin çıkış cihazı artık bulunamadı, varsayılan cihaza dönüldü.'
      )
    }
  }, [audioOutputs, selectedAudioOutput])

  useEffect(() => {
    window.localStorage?.setItem('audioInputId', selectedAudioInput)
  }, [selectedAudioInput])

  useEffect(() => {
    window.localStorage?.setItem('audioOutputId', selectedAudioOutput)
    selectedAudioOutputRef.current = selectedAudioOutput
  }, [selectedAudioOutput])

  // Seçilen çıkış (hoparlör) cihazını, ses çaldığımız AudioContext'e
  // uygula. setSinkId() henüz her ortamda desteklenmeyebilir — o
  // durumda kullanıcıya nazikçe haber veriyoruz, uygulama çökmüyor.
  // DÜZELTME: audioContextRef bir REF olduğu için, context'in gerçekte
  // İLK oluşturulduğu an (bkz. getAudioContext — ilk uzak ses geldiğinde
  // tembel/lazy olarak kuruluyor) bu efekt bunu FARK ETMİYORDU: kullanıcı
  // çıkış cihazını uygulamaya girer girmez (henüz kimse konuşmadan önce)
  // seçmiş olsun, context o an hâlâ null olduğu için setSinkId hiç
  // çağrılmıyor ve context sonradan kurulduğunda bu efekt bir daha ASLA
  // yeniden çalışmıyordu (dependency listesinde context'in kendisi yok) —
  // seçim sessizce hiç uygulanmamış oluyordu. getAudioContext artık
  // context'i kurar kurmaz seçili cihazı uyguluyor; bu efekt ise
  // kullanıcı SOHBET SIRASINDA cihaz değiştirirse devreye giriyor.
  useEffect(() => {
    const ctx = audioContextRef.current
    if (!ctx || !selectedAudioOutput) return
    if (typeof ctx.setSinkId !== 'function') {
      setOutputDeviceError('Bu cihazda çıkış seçimi desteklenmiyor gibi görünüyor.')
      return
    }
    ctx.setSinkId(selectedAudioOutput).catch((err) => {
      setOutputDeviceError(`Çıkış cihazı ayarlanamadı: ${err.message}`)
    })
  }, [selectedAudioOutput, isMicOn, inVoice])

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
  // YENİ: Birinin ekran paylaşımını YENİ BAŞLATTIĞI anı (false->true
  // geçişini) yakalayıp ses çalmak için, önceki durumu saklıyoruz.
  const prevPeersRef = useRef([])
  useEffect(() => {
    peers.forEach((peer) => {
      const prevPeer = prevPeersRef.current.find((p) => p.socketId === peer.socketId)
      if (peer.sharingScreen && !prevPeer?.sharingScreen) {
        playScreenShareSound()
      }
    })
    prevPeersRef.current = peers
  }, [peers])
  const [mediaError, setMediaError] = useState(null)
  const [screenSourceOptions, setScreenSourceOptions] = useState(null)

  // YENİ: büyütülmüş kutucuk — bir video/ekran kutucuğuna tıklayınca
  // o kutucuk büyür, diğerleri küçük bir şeride iner.
  const [enlargedTile, setEnlargedTile] = useState(null)
  const toggleEnlarge = (tileId) => {
    setEnlargedTile((prev) => (prev === tileId ? null : tileId))
  }

  // YENİ: büyütülmüş kutucuk artık tam ekrana yakın bir lightbox — Esc ile
  // de kapatılabilsin (standart lightbox/tam ekran davranışı).
  useEffect(() => {
    if (!enlargedTile) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') setEnlargedTile(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [enlargedTile])

  // YENİ: kişi bazlı ses seviyesi (Discord'daki gibi, %0-%200 arası —
  // normal HTML ses elemanlarının %100 sınırını Web Audio API ile aşıyoruz).
  // ÖNEMLİ: artık geçici bağlantı kimliğine (socketId) DEĞİL, kullanıcı
  // adına göre saklıyoruz — böylece kişi sesten çıkıp girse, ya da sen
  // uygulamayı kapatıp açsan bile ayar kalıcı oluyor. localStorage'a da
  // yazıyoruz ki bir dahaki açılışta da hatırlansın.
  const [peerVolumes, setPeerVolumes] = useState(() => {
    try {
      const saved = window.localStorage?.getItem('peerVolumes')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  }) // { username: 0-200 }
  useEffect(() => {
    try {
      window.localStorage?.setItem('peerVolumes', JSON.stringify(peerVolumes))
    } catch {
      /* localStorage kullanılamıyorsa sorun değil, sadece kalıcılık kaybolur */
    }
  }, [peerVolumes])

  // YENİ: tek, konum-bazlı ses seviyesi popup'ı — hem video kutucuğuna
  // hem üye listesindeki bir isme sağ tıklayınca AYNI popup açılıyor.
  const [volumePopup, setVolumePopup] = useState(null) // { username, x, y } | null
  const openVolumePopup = useCallback((username, e) => {
    e.preventDefault()
    e.stopPropagation()
    setVolumePopup({ username, x: e.clientX, y: e.clientY })
  }, [])
  useEffect(() => {
    if (!volumePopup) return
    const closeIt = () => setVolumePopup(null)
    window.addEventListener('click', closeIt)
    return () => window.removeEventListener('click', closeIt)
  }, [volumePopup])

  const audioContextRef = useRef(null)
  // DÜZELTME: setSinkId()/resume() birer PROMISE — context'i kurar kurmaz
  // grafiğe (source->gain->destination) düğüm bağlamaya başlarsak, bu
  // async işlemler henüz TAMAMLANMADAN düğümler bağlanmış olabiliyordu.
  // Bazı Chromium sürümlerinde çıkış cihazı geçişi ("sink") devam ederken
  // yapılan bağlantılar SESSİZCE hiç ses üretmiyor (yeni sink'e taşınmıyor)
  // — oysa geçiş bittikten SONRA yapılan bir bağlantı (ör. test tonu, daha
  // sonra tıklanıyor) sorunsuz çalışıyor. Artık grafiğe düğüm bağlamadan
  // önce BU promise'i bekliyoruz.
  const audioContextReadyRef = useRef(Promise.resolve())
  const gainNodesRef = useRef(new Map()) // peerSocketId -> GainNode
  const analysersRef = useRef(new Map()) // peerSocketId -> AnalyserNode (teşhis)
  const connectedAudioTracksRef = useRef(new Map()) // peerSocketId -> hangi track'e bağlandık

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioContextRef.current = ctx
      // Context YENİ kuruldu — kullanıcı daha önce (henüz kimse konuşmadan)
      // bir çıkış cihazı seçmiş olabilir. O seçimi hemen burada uyguluyoruz,
      // yoksa bir daha hiç uygulanma fırsatı olmuyordu (bkz. yukarıdaki
      // "DÜZELTME" notu) — ama bunu TAMAMLANMASINI beklememiz gerekiyor,
      // o yüzden bir promise'e sarıp saklıyoruz.
      const sinkId = selectedAudioOutputRef.current
      audioContextReadyRef.current = (async () => {
        if (sinkId && typeof ctx.setSinkId === 'function') {
          try {
            await ctx.setSinkId(sinkId)
          } catch (err) {
            setOutputDeviceError(`Çıkış cihazı ayarlanamadı: ${err.message}`)
          }
        }
        if (ctx.state === 'suspended') {
          try {
            await ctx.resume()
          } catch {
            /* kullanıcı etkileşimi olmadan resume reddedilmiş olabilir, bir sonraki denemede düzelir */
          }
        }
      })()
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  // YENİ (teşhis + kullanıcı için): sesli sohbette kullanılan TAM OLARAK
  // AYNI AudioContext/çıkış cihazı üzerinden bir test tonu çalıyor. Bunu
  // duyabiliyorsan sorun bu uygulamanın ses çıkışı YÖNLENDİRMESİNDE değil
  // demektir (karşı taraftan gelen sesin neden çalınmadığına bakmamız
  // gerekir); duyamıyorsan sorun kesinlikle çıkış cihazı seçiminde/işletim
  // sistemi tarafında demektir — hangi cihaza (id + etiket) ve hangi
  // AudioContext durumuna (running/suspended) çaldığımızı konsola basıyoruz.
  const playTestTone = useCallback(() => {
    const ctx = getAudioContext()
    console.log(
      '[ses testi] AudioContext durumu:',
      ctx.state,
      '— hedeflenen çıkış cihazı:',
      selectedAudioOutputRef.current || '(varsayılan)',
      '— tarayıcının bildirdiği aktif sinkId:',
      ctx.sinkId ?? '(bu tarayıcı sinkId bildirmiyor)'
    )
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.frequency.value = 440
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.6)
  }, [getAudioContext])

  // YENİ: Mikrofon testi — seçili mikrofonu kısa süreliğine açıp canlı bir
  // seviye çubuğu gösteriyor (konuşunca hareket etmeli). Hoparlöre
  // BAĞLAMIYORUZ (yankı/geri besleme olmasın diye) — sadece bir
  // AnalyserNode ile seviyeyi ölçüp okuyoruz. 10 saniye sonra ya da
  // tekrar tıklanınca kendiliğinden kapanır, mikrofonu açık unutmuyoruz.
  const [isTestingMic, setIsTestingMic] = useState(false)
  const [micTestLevel, setMicTestLevel] = useState(0)
  const micTestCleanupRef = useRef(null)

  const stopMicTest = useCallback(() => {
    micTestCleanupRef.current?.()
    micTestCleanupRef.current = null
    setIsTestingMic(false)
    setMicTestLevel(0)
  }, [])

  const testMicrophone = useCallback(async () => {
    if (isTestingMic) {
      stopMicTest()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
      })
      const ctx = getAudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128)
          if (v > peak) peak = v
        }
        setMicTestLevel(Math.min(100, Math.round((peak / 128) * 100)))
        rafId = requestAnimationFrame(tick)
      }
      let rafId = requestAnimationFrame(tick)

      const autoStopTimer = setTimeout(() => stopMicTest(), 10000)

      micTestCleanupRef.current = () => {
        cancelAnimationFrame(rafId)
        clearTimeout(autoStopTimer)
        source.disconnect()
        stream.getTracks().forEach((t) => t.stop())
      }
      setIsTestingMic(true)
    } catch (err) {
      setMediaError(describeMediaError(err))
    }
  }, [isTestingMic, selectedAudioInput, getAudioContext, stopMicTest])

  // Panel kapanırken ya da bileşen kaldırılırken testi arkada bırakma.
  useEffect(() => {
    if (!showAppSettings) stopMicTest()
  }, [showAppSettings, stopMicTest])
  useEffect(() => () => micTestCleanupRef.current?.(), [])

  // YENİ: Sağırlaştır — Discord'daki gibi, herkesin sesini tek tuşla
  // kapatıp, tekrar bastığında herkesi KENDİ ayarladığın ses seviyesine
  // geri getiriyor (0'a sıfırlamıyor, gerçek tercihini unutmuyor).
  const [isDeafened, setIsDeafened] = useState(false)

  // Her uzak ses akışı için (ya da akış değiştiğinde) bir kazanç (gain)
  // düğümü kuruyoruz — bu, kişi bazlı ses seviyesinin gerçek mekanizması.
  useEffect(() => {
    let cancelled = false
    const ctx = getAudioContext()

    // DÜZELTME: context'in kurulması (özellikle setSinkId/resume) ASYNC —
    // grafiğe düğüm bağlamadan önce bunun bitmesini bekliyoruz (bkz.
    // getAudioContext üzerindeki not).
    audioContextReadyRef.current.then(() => {
      if (cancelled) return
      Object.entries(remoteStreams).forEach(([peerSocketId, streams]) => {
        // Ek güvence: birden fazla ses track'i varsa (ör. renegotiation'ın
        // tam ortasında, syncReceiversToStream henüz temizlik yapmadan
        // önceki bir an), her zaman CANLI (muted olmayan) olanı tercih et —
        // [0] körü körüne eski/sessiz bir track'i seçebilirdi.
        const audioTracks = streams.mainStream?.getAudioTracks() ?? []
        const audioTrack = audioTracks.find((t) => !t.muted) ?? audioTracks[0]
        if (!audioTrack) return
        if (connectedAudioTracksRef.current.get(peerSocketId) === audioTrack) return

        try {
          const singleTrackStream = new MediaStream([audioTrack])
          const source = ctx.createMediaStreamSource(singleTrackStream)
          const gainNode = ctx.createGain()
          // YENİ: ses seviyesini artık kullanıcı adından buluyoruz.
          const username = peers.find((p) => p.socketId === peerSocketId)?.username
          const currentVolume = (username && peerVolumes[username]) ?? 100
          // Sağırlaştırılmış durumdayken YENİ birine bağlanırsak (ör. az
          // önce sese giren biri), onun sesi de baştan susturulmalı.
          gainNode.gain.value = isDeafened ? 0 : currentVolume / 100
          source.connect(gainNode).connect(ctx.destination)

          // YENİ (teşhis): bu düğümden GERÇEKTEN sinyal geçiyor mu, yoksa
          // bağlantı kurulmuş ama gelen ses "sessiz" mi — bunu periyodik
          // istatistik döngüsünde (aşağıda) ölçüp konsola basabilmek için
          // bir AnalyserNode da takıyoruz (ana çıkışı etkilemiyor, sadece
          // "dinliyor").
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 512
          gainNode.connect(analyser)
          const oldAnalyser = analysersRef.current.get(peerSocketId)
          if (oldAnalyser) {
            try {
              oldAnalyser.disconnect()
            } catch {
              /* zaten kopmuş olabilir */
            }
          }
          analysersRef.current.set(peerSocketId, analyser)

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
          console.log(
            `[ses seviyesi] ${peerSocketId} için bağlandı — ctx.state: ${ctx.state}, gain: ${gainNode.gain.value}`
          )
        } catch (err) {
          console.error(`[ses seviyesi] ${peerSocketId} için kurulamadı:`, err)
        }
      })
    })

    // Artık remoteStreams'te olmayan kişilerin düğümlerini temizle.
    gainNodesRef.current.forEach((gainNode, peerSocketId) => {
      if (!remoteStreams[peerSocketId]?.mainStream) {
        gainNode.disconnect()
        gainNodesRef.current.delete(peerSocketId)
        connectedAudioTracksRef.current.delete(peerSocketId)
        const analyser = analysersRef.current.get(peerSocketId)
        if (analyser) {
          analyser.disconnect()
          analysersRef.current.delete(peerSocketId)
        }
      }
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStreams, getAudioContext, peers, isDeafened])

  // YENİ: artık kullanıcı adına göre ayarlıyoruz — o kişi şu an sesteyse
  // canlı ses seviyesini de anında güncelliyoruz, sesteyken olmasa bile
  // tercih kaydediliyor (bir dahaki sese girişinde uygulanır).
  const setPeerVolume = useCallback(
    (username, percent) => {
      setPeerVolumes((prev) => ({ ...prev, [username]: percent }))
      const peerSocketId = peers.find((p) => p.username === username)?.socketId
      const gainNode = peerSocketId ? gainNodesRef.current.get(peerSocketId) : null
      if (gainNode) gainNode.gain.value = percent / 100
    },
    [peers]
  )

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

  // YENİ: Ping göstergesi — her bağlantının GERÇEK gidiş-dönüş süresini
  // (RTT), WebRTC'nin kendi istatistik API'sinden periyodik olarak
  // okuyoruz. Mesh mimarisinde herkesle AYRI bir bağlantı olduğu için,
  // kişi başına ayrı bir ping değeri anlamlı oluyor.
  const [peerPings, setPeerPings] = useState({}) // { peerSocketId: ms }
  useEffect(() => {
    if (!inVoice) {
      setPeerPings({})
      return
    }
    const interval = setInterval(async () => {
      const updates = {}
      for (const [peerSocketId, entry] of peerConnectionsRef.current.entries()) {
        const pc = entry.mainPc
        if (pc) {
          try {
            const stats = await pc.getStats()
            const candidateTypes = new Map() // candidate id -> type (local-candidate raporlarından)
            stats.forEach((report) => {
              if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                candidateTypes.set(report.id, report.candidateType)
              }
            })
            stats.forEach((report) => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                if (typeof report.currentRoundTripTime === 'number') {
                  updates[peerSocketId] = Math.round(report.currentRoundTripTime * 1000)
                }
                // YENİ (teşhis): AKTİF bağlantı gerçekten TURN röle mi
                // kullanıyor, yoksa doğrudan mı (host/srflx) kuruldu?
                console.log(
                  `[ICE seçilen yol] ${peerSocketId} yerel: ${candidateTypes.get(report.localCandidateId)}, karşı: ${candidateTypes.get(report.remoteCandidateId)}`
                )
              }
              // YENİ (teşhis): ses verisi GERÇEKTEN gidiyor/geliyor mu?
              if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                console.log(
                  `[ses teşhis] ${peerSocketId} GÖNDERİLEN ses: ${report.bytesSent} bayt, ${report.packetsSent} paket`
                )
              }
              if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                console.log(
                  `[ses teşhis] ${peerSocketId} ALINAN ses: ${report.bytesReceived} bayt, ${report.packetsReceived} paket`
                )
              }
            })
          } catch {
            // Bağlantı henüz tam kurulmamış olabilir — bir sonraki turda tekrar dener.
          }
        }

        // YENİ (teşhis): ekran paylaşımının sesi de AYRI bir bağlantı
        // (screenPc) üzerinden gidiyor — mikrofon sesi akıyor olsa bile
        // bu, hiç kontrol edilmiyordu. Ekran paylaşımının sesi gitmiyorsa
        // bytesSent/bytesReceived'in 0'da takılı kalıp kalmadığına bak:
        // 0'da kalıyorsa sorun YAKALAMA'da (sistem sesi hiç alınamıyor),
        // artıyorsa sorun ÇALMA tarafında.
        const screenPc = entry.screenPc
        if (screenPc) {
          try {
            const screenStats = await screenPc.getStats()
            screenStats.forEach((report) => {
              if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                console.log(
                  `[ekran ses teşhis] ${peerSocketId} GÖNDERİLEN ekran sesi: ${report.bytesSent} bayt, ${report.packetsSent} paket`
                )
              }
              if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                console.log(
                  `[ekran ses teşhis] ${peerSocketId} ALINAN ekran sesi: ${report.bytesReceived} bayt, ${report.packetsReceived} paket`
                )
              }
            })
          } catch {
            // screenPc henüz kurulma aşamasında olabilir.
          }
        }

        // YENİ (teşhis): mikrofon sesi için kurduğumuz Web Audio grafiğinde
        // (AnalyserNode) GERÇEKTEN sinyal var mı? bytesReceived artıyor
        // olsa bile, bu grafikte 0 çıkıyorsa sorun kesinlikle GainNode
        // bağlantısı/AudioContext tarafında demektir; burada da 0 çıkıp bir
        // de duyulmuyorsa ve bytesReceived artıyorsa, gelen ses GERÇEKTEN
        // sessiz olabilir (karşı taraf konuşurken bile).
        const analyser = analysersRef.current.get(peerSocketId)
        if (analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128)
            if (v > peak) peak = v
          }
          console.log(
            `[ses seviyesi ölçüm] ${peerSocketId} anlık tepe genlik: ${peak}/128 (0 = tam sessizlik)`
          )
        }
      }
      setPeerPings((prev) => ({ ...prev, ...updates }))
    }, 2500)
    return () => clearInterval(interval)
  }, [inVoice])

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

  // DÜZELTME (BULUNAN ASIL SES BUGI): bu fonksiyon adının aksine daha
  // önce SADECE ekliyordu, hiç ÇIKARMIYORDU. Bir alıcının (receiver)
  // track'i renegotiation sırasında YENİ bir track nesnesiyle
  // değiştiğinde (ör. biri mikrofonu ilk kez açtığında), ESKİ (hiçbir
  // zaman canlı veri taşımamış, sonsuza dek sessiz) track hâlâ
  // MediaStream'in İÇİNDE kalıyordu — ve İLK eklenen o olduğu için
  // `getAudioTracks()[0]` HER ZAMAN o eski/sessiz track'i döndürüyordu,
  // gerçek/canlı track ikinci sıraya düşüp hiç kullanılmıyordu. Bu da
  // tam olarak gözlemlenen belirtiyi açıklıyor: WebRTC istatistiklerinde
  // bytesReceived artıyor (ses paketleri GERÇEKTEN geliyor) ama Web Audio
  // grafiğindeki analiz hep 0 gösteriyordu (yanlış/eski track'i dinliyorduk).
  // Artık MediaStream'i pc.getReceivers()'ın GÜNCEL haliyle tam senkronize
  // ediyoruz: artık orada olmayan track'leri çıkarıyoruz, yenilerini ekliyoruz.
  const syncReceiversToStream = useCallback((pc, peerSocketId, connectionType) => {
    const streamKey = connectionType === 'screen' ? 'screenStream' : 'mainStream'
    const receivers = pc.getReceivers()
    const liveTracks = new Set(receivers.map((r) => r.track).filter(Boolean))
    setRemoteStreams((prev) => {
      const peerEntry = prev[peerSocketId] || {}
      const existing = peerEntry[streamKey] || new MediaStream()
      let changed = false
      existing.getTracks().forEach((track) => {
        if (!liveTracks.has(track)) {
          existing.removeTrack(track)
          changed = true
        }
      })
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

      // Perfect Negotiation: her iki uç da bu bağlantı için AYNI sonuca
      // bağımsız olarak varmalı ki biri "polite" biri "impolite" olsun.
      // Socket ID'leri string olarak karşılaştırıyoruz — karşı taraf aynı
      // karşılaştırmayı ters sırada yaptığı için sonuç simetrik olarak
      // farklı çıkıyor (biri true, diğeri false).
      pc.polite = (socketRef.current?.id ?? '') < peerSocketId
      pc.makingOffer = false
      pc.ignoreOffer = false
      pc.isSettingRemoteAnswerPending = false

      pc.ontrack = () => {
        syncReceiversToStream(pc, peerSocketId, connectionType)
      }
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          // YENİ (teşhis): toplanan her adayın TÜRünü (host/srflx/relay)
          // logluyoruz — "relay" hiç görünmüyorsa TURN sunucusuna hiç
          // ulaşılamıyor demektir (yanlış URL, kapalı port, geçersiz
          // kimlik bilgisi); "relay" görünüyor ama bağlantı yine de
          // kurulamıyorsa sorun başka bir yerde.
          console.log(
            `[ICE aday] ${peerSocketId}/${connectionType} tür: ${event.candidate.type}, protokol: ${event.candidate.protocol}`
          )
          socketRef.current.emit('signal', {
            to: peerSocketId,
            data: { type: 'ice-candidate', candidate: event.candidate, connectionType },
          })
        }
      }
      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC ${peerSocketId}/${connectionType}] durum: ${pc.connectionState}`)
      }
      // YENİ (teşhis): connectionState DTLS+ICE'yi birlikte özetliyor —
      // sadece ICE'nin kendisinin (NAT geçişi) başarılı olup olmadığını
      // ayrı görmek için iceConnectionState'i de ayrıca logluyoruz.
      // "failed" görürsen bu, TURN gerekiyordu ama kullanılamadı demektir.
      pc.oniceconnectionstatechange = () => {
        console.log(
          `[ICE bağlantı durumu] ${peerSocketId}/${connectionType}: ${pc.iceConnectionState}`
        )
      }
      pc.onnegotiationneeded = async () => {
        if (pc.makingOffer) return
        try {
          pc.makingOffer = true
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
        // YENİ: paylaşım zaten sistem sesiyle devam ediyorsa, YENİ katılan
        // bir kişiye kurulan bağlantıya da o sesi ekliyoruz.
        const screenAudioTrack = localScreenStreamRef.current?.getAudioTracks()[0]
        if (screenAudioTrack) pc.addTrack(screenAudioTrack, localScreenStreamRef.current)
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
    setVoiceChannel(null)
    setVolumePopup(null)
    setIsDeafened(false)
    // YENİ: ses seviyesi düğümlerini de temizle (bir sonraki sese
    // girişte sıfırdan, temiz kurulacaklar).
    gainNodesRef.current.forEach((gainNode) => gainNode.disconnect())
    gainNodesRef.current.clear()
    connectedAudioTracksRef.current.clear()
  }, [stopLocalMedia, cleanupPeerConnections])

  // YENİ: Sese katıl — metin kanalına ZATEN girmiş olmamız lazım. Hangi
  // kanaldayken katıldıysak (activeChannelRef.current), ses O kanala
  // bağlanıyor — sonradan başka bir kanalın mesajlarına göz atsan bile
  // ses hep bu kanalda kalır.
  const joinVoice = useCallback(() => {
    if (!socketRef.current) return
    socketRef.current.emit('join-voice', { token: sessionTokenRef.current })
    setInVoice(true)
    setVoiceChannel(activeChannelRef.current)
  }, [])

  const leaveChannel = useCallback(() => {
    cleanupSocket()
    stopLocalMedia()
    cleanupPeerConnections()
    setPeers([])
    setMessages([])
    setEphemeralPhotos([])
    setTypingUsers([])
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
    setVoiceChannel(null)
    setEnlargedTile(null)
    setActiveChannel(null)
  }, [cleanupSocket, stopLocalMedia, cleanupPeerConnections])

  // YENİ: Kanala (METİN) katılma — ses bağlantısı burada HİÇ kurulmuyor.
  const joinChannel = useCallback(
    (channelName) => {
      // DÜZELTME: sesteyken başka bir kanala TIKLAYIP sadece mesajlarına
      // göz atmak istiyorsan, soketi/mikrofonu/eş bağlantılarını YIKMAMIZ
      // gerekmiyor — sadece HANGİ kanalın mesajlarını izlediğimizi
      // değiştiriyoruz (var olan soket üzerinden 'join-channel' tekrar
      // gönderilir). Ses bağlantısı olduğu kanalda (voiceChannel) kalmaya
      // devam eder. Sunucu tarafında da metin/ses odaları zaten ayrı
      // (bkz. server.js — currentTextRoom / currentVoiceRoom).
      if (inVoice && socketRef.current?.connected && channelName !== activeChannelRef.current) {
        setMessages([])
        setEphemeralPhotos([])
        setTypingUsers([])
        setUnreadChannels((prev) => prev.filter((c) => c !== channelName))
        setHasMoreHistory(true)
        setOnlineMembers([])
        setOfflineMembers([])
        setConnectionError(null)
        setEnlargedTile(null)
        setActiveChannel(channelName)
        socketRef.current.emit('join-channel', {
          roomId: channelName,
          token: sessionTokenRef.current,
        })
        return
      }

      cleanupSocket()
      stopLocalMedia()
      cleanupPeerConnections()
      setPeers([])
      setMessages([])
      setEphemeralPhotos([])
      setTypingUsers([])
      setUnreadChannels((prev) => prev.filter((c) => c !== channelName))
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
      setVoiceChannel(null)
      setEnlargedTile(null)
      setActiveChannel(channelName)

      const socket = io(SERVER_URL)
      socketRef.current = socket

      socket.on('connect', () => {
        setConnectionStatus('connected')
        socket.emit('join-channel', {
          roomId: channelName,
          token: sessionTokenRef.current,
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
        // YENİ: Kendi mesajım değilse ses çal — beni @bahsetmişse (ve
        // pencere görünür değilse) daha belirgin olan bahsetme sesi,
        // aksi halde her mesaj için nazik bir "tık" sesi. İkisi asla
        // aynı anda çalmıyor.
        const isOwnMessage = message.username === displayName
        // YENİ: "@all" da tıpkı kendi adının bahsedilmesi gibi bildirim
        // sesi çalsın — herkese yönelik bir çağrı, sadece belirli bir
        // kişiye değil.
        const isMention =
          (displayName && message.text?.toLowerCase().includes(`@${displayName.toLowerCase()}`)) ||
          message.text?.toLowerCase().includes('@all')
        if (!isOwnMessage) {
          if (isMention && document.hidden) {
            playMentionSound()
          } else {
            playMessageSound()
          }
        }
        requestAnimationFrame(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
          }
        })
      })

      // YENİ: fotoğraf geldiğinde — kalıcı 'messages' listesine DEĞİL,
      // ayrı ve geçici 'ephemeralPhotos' listesine ekleniyor.
      socket.on('new-photo', (photo) => {
        setEphemeralPhotos((prev) => [...prev, photo])
        if (photo.username !== displayName) playMessageSound()
        requestAnimationFrame(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
          }
        })
      })

      // YENİ: Yazıyor göstergesi.
      socket.on('user-typing', ({ username }) => {
        setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]))
      })
      socket.on('user-stopped-typing', ({ username }) => {
        setTypingUsers((prev) => prev.filter((u) => u !== username))
      })

      // YENİ: Bir mesajın tepkileri değiştiğinde, o mesajı güncelle.
      socket.on('reactions-updated', ({ messageId, reactions }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
        )
      })

      // YENİ: Mesaj(lar) silindiğinde, listeden kaldır.
      socket.on('messages-deleted', ({ messageIds }) => {
        setMessages((prev) => prev.filter((m) => !messageIds.includes(m.id)))
      })

      // YENİ: Bir mesaj düzenlendiğinde, metnini güncelle.
      socket.on('message-edited', ({ messageId, newText, editedAt }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: newText, editedAt } : m))
        )
      })

      // YENİ: Üye olunan bir kanalda (o an İÇİNDE olunmayan) yeni
      // aktivite olursa, okunmamış işareti koy. activeChannelRef ile
      // "zaten o kanaldaysam görmezden gel" kontrolü yapıyoruz.
      socket.on('channel-activity', ({ channel }) => {
        if (channel === activeChannelRef.current) return
        setUnreadChannels((prev) => (prev.includes(channel) ? prev : [...prev, channel]))
      })

      // ---- Ses (voice) ile ilgili dinleyiciler — 'sese katıl' denene kadar
      // tetiklenmezler ama baştan hazır olmaları lazım. ----
      socket.on('existing-voice-users', (users) => {
        setPeers(users)
      })

      socket.on('voice-user-joined', (user) => {
        setPeers((prev) => [...prev, user])
        getOrCreateMainConnection(user.socketId)
        playJoinSound()
      })

      socket.on('voice-user-left', ({ socketId }) => {
        playLeaveSound()
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
            // Perfect Negotiation: aynı anda iki taraf da teklif göndermiş
            // olabilir (glare) — biz de kendi teklifimizi gönderiyorsak ya
            // da zaten "stable" olmayan bir durumdaysak bu bir çakışmadır.
            // "Kibar" (polite) taraf kendi teklifinden vazgeçip karşı
            // tarafınkini kabul eder; "kaba" (impolite) taraf ise kendi
            // teklifinde ısrar edip geleni yok sayar.
            const offerCollision =
              pc.makingOffer ||
              (!pc.isSettingRemoteAnswerPending && pc.signalingState !== 'stable')
            pc.ignoreOffer = !pc.polite && offerCollision
            if (pc.ignoreOffer) {
              console.warn(
                `[signal] ${from}/${connectionType} - çakışan teklif yok sayıldı (impolite taraf)`
              )
              return
            }
            // Not: pc.polite true iken burada setRemoteDescription çağrılması,
            // signalingState "have-local-offer" ise tarayıcı tarafından
            // otomatik olarak rollback yapılmasını sağlar (spec gereği).
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('signal', {
              to: from,
              data: { type: 'answer', sdp: pc.localDescription, connectionType },
            })
            syncReceiversToStream(pc, from, connectionType)
          } else if (data.type === 'answer') {
            pc.isSettingRemoteAnswerPending = true
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
            pc.isSettingRemoteAnswerPending = false
            syncReceiversToStream(pc, from, connectionType)
          } else if (data.type === 'ice-candidate') {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
            } catch (err) {
              // Kibar tarafın az önce yok saydığı bir teklife ait aday
              // gelmiş olabilir — bu durumda hata beklenen bir şeydir.
              if (!pc.ignoreOffer) throw err
            }
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

      // YENİ: profil fotoğrafını değiştirince sunucudan kesin onay —
      // kendi görünümümüzü de anında güncelliyoruz.
      socket.on('avatar-saved', ({ avatarData }) => {
        setMyAvatar(avatarData || null)
        setIsUploadingAvatar(false)
      })

      // YENİ: Alganis rolü bir kullanıcının rollerini ekleyip/çıkarınca,
      // Üye Yönetimi listesindeki o satırı yerel olarak da güncelle.
      socket.on('user-role-updated', ({ username: targetUsername, roles }) => {
        setAllUsers((prev) =>
          prev.map((u) => (u.username === targetUsername ? { ...u, roles } : u))
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
      inVoice,
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
          console.log('[mikrofon] getUserMedia çağrılıyor...')
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
          })
          const newAudioTrack = micStream.getAudioTracks()[0]
          console.log(
            '[mikrofon] Track alındı — enabled:',
            newAudioTrack.enabled,
            'readyState:',
            newAudioTrack.readyState,
            'muted:',
            newAudioTrack.muted,
            'label:',
            newAudioTrack.label
          )
          const otherTracks = localMainStream ? localMainStream.getTracks() : []
          const newLocalStream = new MediaStream([...otherTracks, newAudioTrack])
          setLocalMainStream(newLocalStream)
          setIsMicOn(true)
          addTrackToMainConnections(newAudioTrack, newLocalStream)
          console.log(
            '[mikrofon] Şu an açık bağlantı sayısı:',
            peerConnectionsRef.current.size
          )
          socketRef.current?.emit('state-update', { muted: false })
        } catch (err) {
          console.error('[mikrofon] getUserMedia HATASI:', err.name, err.message)
          setMediaError(describeMediaError(err))
        }
        return
      }
      existingAudioTrack.enabled = active
      setIsMicOn(active)
      socketRef.current?.emit('state-update', { muted: !active })
    },
    [localMainStream, addTrackToMainConnections, selectedAudioInput]
  )

  // YENİ: Herkesin sesini, kayıtlı tercihine (peerVolumes) göre geri
  // getiren ortak fonksiyon — hem "sağırlığı kapat" hem de "PTT ile
  // mikrofonu açarken sağırlığı otomatik temizle" bunu kullanıyor,
  // ikisi de AYNI mantığı çalıştırsın diye (önceden PTT bu adımı hiç
  // yapmıyordu — bu yüzden PTT kullanınca ses gelmemeye devam
  // edebiliyordu, sağırlık sessizce takılı kalıyordu).
  const restoreAllPeerVolumes = useCallback(() => {
    gainNodesRef.current.forEach((gainNode, peerSocketId) => {
      const username = peers.find((p) => p.socketId === peerSocketId)?.username
      const volume = (username && peerVolumes[username]) ?? 100
      gainNode.gain.value = volume / 100
    })
  }, [peers, peerVolumes])

  const clearDeafenIfActive = useCallback(() => {
    setIsDeafened((prev) => {
      if (!prev) return prev
      restoreAllPeerVolumes()
      return false
    })
  }, [restoreAllPeerVolumes])

  const toggleMic = useCallback(() => {
    // sağırken mikrofonu AÇMAYA çalışırsan, "duymuyorum ama konuşabiliyorum"
    // gibi tuhaf bir duruma düşmeyelim diye sağırlığı da otomatik kaldırıyoruz.
    if (!isMicOn) clearDeafenIfActive()
    setMicActive(!isMicOn)
  }, [isMicOn, setMicActive, clearDeafenIfActive])

  // YENİ: Sağırlaştır/aç — herkesin sesini aynı anda kapatıp açıyor.
  // Açarken, kişilerin ayarladığın 0-200 ses seviyesi tercihine (bkz.
  // peerVolumes) geri dönüyor, hepsini %100'e sıfırlamıyor.
  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev
      if (next) {
        gainNodesRef.current.forEach((gainNode) => {
          gainNode.gain.value = 0
        })
        // Duymuyorsan konuşmana da gerek yok — mikrofonu da kapat.
        if (isMicOn) setMicActive(false)
      } else {
        restoreAllPeerVolumes()
      }
      return next
    })
  }, [isMicOn, setMicActive, restoreAllPeerVolumes])

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
        clearDeafenIfActive()
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
  }, [pttEnabled, pttKey, inVoice, setMicActive, clearDeafenIfActive])

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
      // YENİ: video:true'nun yanına audio:true eklemek, Electron'a "sistem
      // sesini de yakala" sinyali veriyor (asıl izin main.cjs'teki
      // 'loopback' ayarından geliyor).
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      const screenTrack = screenStream.getVideoTracks()[0]
      screenTrack.onended = () => stopScreenShare()
      setLocalScreenStream(screenStream)
      setIsScreenSharing(true)
      addTrackToScreenConnections(screenTrack, screenStream)
      // Sistem sesi yakalanabildiyse (her zaman garanti değil, kaynağa
      // göre değişebilir), onu da ayrıca gönderiyoruz.
      const screenAudioTrack = screenStream.getAudioTracks()[0]
      // YENİ (teşhis): sistem sesi hiç YAKALANAMADIYSA (Windows'ta loopback
      // her zaman garanti değil), bunu en baştan burada görmemiz lazım —
      // yoksa "ses gitmiyor" şikayeti gelince nereden başlayacağımızı
      // bilemiyoruz (yakalama mı, iletim mi, çalma mı?).
      console.log(
        '[ekran sesi] sistem sesi track’i:',
        screenAudioTrack
          ? `VAR — enabled:${screenAudioTrack.enabled}, readyState:${screenAudioTrack.readyState}, muted:${screenAudioTrack.muted}, label:${screenAudioTrack.label}`
          : 'YOK (bu ekran/pencere kaynağından sistem sesi yakalanamadı)'
      )
      if (screenAudioTrack) {
        addTrackToScreenConnections(screenAudioTrack, screenStream)
      }
      socketRef.current?.emit('state-update', { sharingScreen: true })
      playScreenShareSound()
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
          // YENİ (teşhis): sunucudan GERÇEKTEN hangi ICE sunucularının
          // geldiğini konsola basıyoruz — TURN sadece STUN'ın yanına bir
          // satır daha eklenmiş mi (ExpressTurn vb. doğru okunmuş mu),
          // yoksa sunucu ortam değişkenleri (TURN_URL/USERNAME/CREDENTIAL)
          // ayarlanmamış olduğu için sessizce sadece STUN mu geldi — bunu
          // buradan kesin görebiliriz.
          console.log('[ICE sunucuları] sunucudan gelenler:', response.iceServers)

          setChannels(Array.isArray(response.channels) ? response.channels : [])
          setMyAvatar(response.avatarData || null)
          // YENİ (teşhis): sunucudan GERÇEKTEN hangi rollerin geldiğini
          // konsola basıyoruz — "Üye Yönetimi" bölümü isAdmin (roles
          // içinde "Alganis" var mı) kontrolüne bağlı, sorunun DB'de mi
          // yoksa istemcinin bunu okuma/gösterme tarafında mı olduğunu
          // buradan ayırt edebiliriz.
          console.log('[giriş] sunucudan gelen roller:', response.roles)
          setMyRoles(Array.isArray(response.roles) ? response.roles : [])
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

  // YENİ: Kayıt ol — davet kodu doğruysa hesap oluşur, sonra kullanıcı
  // normal giriş formuna dönüp giriş yapar (otomatik giriş yapmıyoruz,
  // şifresini bir daha yazıp doğrulaması daha güvenli bir alışkanlık).
  const handleRegister = (e) => {
    e.preventDefault()
    if (!username.trim() || !password || !inviteCode.trim()) return
    setIsRegistering(true)
    setRegisterError(null)
    setRegisterSuccessMessage(null)

    const tempSocket = io(SERVER_URL)
    tempSocket.on('connect', () => {
      tempSocket.emit(
        'register',
        { username: username.trim(), password, inviteCode: inviteCode.trim() },
        (response) => {
          tempSocket.disconnect()
          setIsRegistering(false)
          if (response?.success) {
            setAuthMode('login')
            setPassword('')
            setInviteCode('')
            setRegisterSuccessMessage('Kayıt başarılı! Şimdi giriş yapabilirsin.')
          } else {
            setRegisterError(response?.message || 'Kayıt başarısız.')
          }
        }
      )
    })
    tempSocket.on('connect_error', () => {
      setIsRegistering(false)
      setRegisterError('Sunucuya bağlanılamadı.')
      tempSocket.disconnect()
    })
  }

  const handleSendMessage = (e) => {
    e.preventDefault()
    const text = chatInput.trim()
    if (!text || !socketRef.current) return

    // YENİ: "!sil n" komutu — kendi son N mesajını topluca siler.
    const silMatch = text.match(/^!sil\s+(\d+)$/i)
    if (silMatch) {
      socketRef.current.emit('delete-last-n', {
        token: sessionTokenRef.current,
        n: Number(silMatch[1]),
      })
      setChatInput('')
      return
    }

    // YENİ: "!sil @kullanıcı n" komutu — BAŞKASININ son N mesajını siler
    // (tümünü değil, "!sil @kullanıcı" bunu yapıyor zaten). Yetki kontrolü
    // sunucuda yapılıyor (sadece "Alganis" rolündeki hesaplar).
    const silUserCountMatch = text.match(/^!sil\s+@?(\S+)\s+(\d+)$/i)
    if (silUserCountMatch) {
      socketRef.current.emit('delete-user-last-n', {
        token: sessionTokenRef.current,
        targetUsername: silUserCountMatch[1],
        n: Number(silUserCountMatch[2]),
      })
      setChatInput('')
      return
    }

    // YENİ: "!sil @kullanıcı" komutu — BAŞKASININ tüm mesajlarını
    // topluca siler. Yetki kontrolü sunucuda yapılıyor (sadece "Alganis"
    // rolündeki hesaplar) — burada sadece söz dizimini ayırt ediyoruz,
    // yukarıdaki kalıplarla eşleşmeyen her "!sil <şey>" bunu dener.
    const silUserMatch = text.match(/^!sil\s+@?(\S+)$/i)
    if (silUserMatch) {
      socketRef.current.emit('delete-user-messages', {
        token: sessionTokenRef.current,
        targetUsername: silUserMatch[1],
      })
      setChatInput('')
      return
    }

    socketRef.current.emit('send-message', { token: sessionTokenRef.current, text })
    setChatInput('')
    // Mesaj gönderilince "yazıyor" durumunu hemen bitir.
    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
    }
    if (isTypingRef.current) {
      isTypingRef.current = false
      socketRef.current.emit('typing-stop', { token: sessionTokenRef.current })
    }
  }

  // YENİ: Yazıyor göstergesi — her tuşta "typing-start" göndermek yerine,
  // sadece BAŞLARKEN bir kere gönderiyoruz; 3 saniye sessizlik olunca
  // otomatik "typing-stop" gidiyor.
  const handleChatInputChange = (e) => {
    setChatInput(e.target.value)
    if (!socketRef.current) return

    if (!isTypingRef.current) {
      isTypingRef.current = true
      socketRef.current.emit('typing-start', { token: sessionTokenRef.current })
    }
    if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
    typingStopTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false
      socketRef.current?.emit('typing-stop', { token: sessionTokenRef.current })
    }, 3000)
  }

  // YENİ: @ yazarken üye önerisi. NOT: basit tutmak için imlecin metnin
  // TAM SONUNDA olduğunu varsayıyor (metnin ortasına @ eklemeyi
  // desteklemiyor) — en yaygın kullanım şekli olan "mesajın sonuna
  // birini etiketle" senaryosunu karşılıyor.
  const mentionRegex = /(^|\s)@(\w*)$/i
  const mentionMatch = chatInput.match(mentionRegex)
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null
  const mentionCandidates =
    mentionQuery === null
      ? []
      : [
          { username: 'all', label: '@all — herkese' },
          ...onlineMembers
            .filter((m) => m.username !== displayName)
            .map((m) => ({ username: m.username, label: `@${m.username}` })),
        ].filter((c) => c.username.toLowerCase().startsWith(mentionQuery))

  const insertMention = (targetUsername) => {
    setChatInput((prev) => prev.replace(mentionRegex, (_match, leading) => `${leading}@${targetUsername} `))
    chatInputRef.current?.focus()
  }

  // YENİ: Fotoğraf gönderme — dosya seçme VE Ctrl+V yapıştırma, ikisi de
  // bu ortak fonksiyonu kullanıyor. Boyutu/tipini kontrol edip base64'e
  // çevirip gönderiyoruz. HİÇBİR YERE kaydedilmiyor, sadece o an kanalda
  // olanlara anlık iletiliyor.
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

  const sendPhotoFile = (file) => {
    if (!file || !socketRef.current) return

    if (!file.type.startsWith('image/')) {
      setMediaError('Sadece görsel dosyaları paylaşılabilir.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setMediaError('Fotoğraf çok büyük (en fazla 10 MB olabilir).')
      return
    }

    setIsSendingPhoto(true)
    const reader = new FileReader()
    reader.onload = () => {
      socketRef.current?.emit('send-photo', {
        token: sessionTokenRef.current,
        imageData: reader.result,
        mimeType: file.type,
      })
      setIsSendingPhoto(false)
    }
    reader.onerror = () => {
      setMediaError('Fotoğraf okunamadı, tekrar dener misin?')
      setIsSendingPhoto(false)
    }
    reader.readAsDataURL(file)
  }

  // YENİ: Profil fotoğrafı yükleme — send-photo'daki geçici fotoğraflardan
  // farklı olarak KALICI ve küçük olmalı. Kaynak resim ne kadar büyük
  // olursa olsun, burada 256x256'lık bir kareye ("cover" gibi kırparak)
  // sıkıştırıp JPEG'e çeviriyoruz — hem sunucudaki boyut sınırını rahat
  // geçer hem veritabanını şişirmez.
  const uploadAvatar = (file) => {
    if (!file || !socketRef.current) return
    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('Sadece görsel dosyaları kullanılabilir.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setAvatarUploadError('Resim çok büyük (en fazla 10 MB olabilir).')
      return
    }
    setAvatarUploadError(null)
    setIsUploadingAvatar(true)

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const scale = Math.max(size / img.width, size / img.height)
        const drawWidth = img.width * scale
        const drawHeight = img.height * scale
        ctx.drawImage(img, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
        socketRef.current?.emit('set-avatar', {
          token: sessionTokenRef.current,
          imageData: dataUrl,
          mimeType: 'image/jpeg',
        })
        // NOT: isUploadingAvatar burada değil, sunucudan 'avatar-saved'
        // gelince kapatılıyor — gerçekten kaydedildiğinden emin olalım diye.
        setTimeout(() => setIsUploadingAvatar(false), 8000) // yanıt hiç gelmezse takılı kalmasın
      }
      img.onerror = () => {
        setAvatarUploadError('Resim okunamadı, tekrar dener misin?')
        setIsUploadingAvatar(false)
      }
      img.src = reader.result
    }
    reader.onerror = () => {
      setAvatarUploadError('Dosya okunamadı, tekrar dener misin?')
      setIsUploadingAvatar(false)
    }
    reader.readAsDataURL(file)
  }

  const handleAvatarFileSelected = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    uploadAvatar(file)
  }

  // YENİ: Alganis rolü için üye/rol yönetimi — Ayarlar panelindeki
  // "Üye Yönetimi" bölümü açıldığında tüm kayıtlı kullanıcıları çekiyoruz.
  // NOT: burada gösterilmesi sadece arayüz kolaylığı — gerçek yetki
  // kontrolü sunucuda, her istekte yeniden yapılıyor.
  const fetchAllUsers = useCallback(() => {
    if (!socketRef.current) return
    setIsLoadingUsers(true)
    setUserManagementError(null)
    socketRef.current.emit('list-all-users', { token: sessionTokenRef.current }, (response) => {
      setIsLoadingUsers(false)
      if (response?.success) {
        setAllUsers(response.users || [])
      } else {
        setUserManagementError(response?.message || 'Kullanıcı listesi alınamadı.')
      }
    })
  }, [])

  useEffect(() => {
    if (showAppSettings && isAdmin) fetchAllUsers()
  }, [showAppSettings, isAdmin, fetchAllUsers])

  const addRoleToUser = (targetUsername) => {
    const role = (roleInputByUser[targetUsername] || '').trim()
    if (!role || !socketRef.current) return
    socketRef.current.emit('update-user-role', {
      token: sessionTokenRef.current,
      targetUsername,
      role,
      action: 'add',
    })
    setRoleInputByUser((prev) => ({ ...prev, [targetUsername]: '' }))
  }

  const removeRoleFromUser = (targetUsername, role) => {
    socketRef.current?.emit('update-user-role', {
      token: sessionTokenRef.current,
      targetUsername,
      role,
      action: 'remove',
    })
  }

  // YENİ: Bir mesaja emoji tepkisi ekleme/kaldırma (aç/kapa).
  const handleToggleReaction = (messageId, emoji) => {
    socketRef.current?.emit('toggle-reaction', {
      token: sessionTokenRef.current,
      messageId,
      emoji,
    })
  }

  // YENİ: Sohbet alanına dosya sürükleyip bırakma — fotoğraf yapıştırmayla
  // aynı ortak fonksiyonu (sendPhotoFile) kullanıyor.
  const handleChatDragOver = (e) => {
    e.preventDefault()
    setIsDraggingPhoto(true)
  }
  const handleChatDragLeave = () => {
    setIsDraggingPhoto(false)
  }
  const handleChatDrop = (e) => {
    e.preventDefault()
    setIsDraggingPhoto(false)
    const file = e.dataTransfer.files?.[0]
    if (file) sendPhotoFile(file)
  }

  // YENİ: tepki paneli artık üzerine gelince değil, sağ tıklayınca
  // açılıyor — sürekli fare gezdirirken panelin açılıp kapanması göz
  // yoruyordu.
  const [reactionPickerForMessageId, setReactionPickerForMessageId] = useState(null)
  const handleMessageContextMenu = (e, messageId) => {
    e.preventDefault()
    setReactionPickerForMessageId((prev) => (prev === messageId ? null : messageId))
  }
  useEffect(() => {
    if (!reactionPickerForMessageId) return
    const closeIt = () => setReactionPickerForMessageId(null)
    window.addEventListener('click', closeIt)
    return () => window.removeEventListener('click', closeIt)
  }, [reactionPickerForMessageId])

  // YENİ: Mesaj düzenleme/silme — sadece KENDİ mesajın için.
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const handleStartEdit = (message) => {
    setEditingMessageId(message.id)
    setEditingText(message.text)
    setReactionPickerForMessageId(null)
  }
  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditingText('')
  }
  const handleSubmitEdit = (messageId) => {
    const trimmed = editingText.trim()
    if (trimmed) {
      socketRef.current?.emit('edit-message', {
        token: sessionTokenRef.current,
        messageId,
        newText: trimmed,
      })
    }
    setEditingMessageId(null)
    setEditingText('')
  }
  const handleDeleteMessage = (messageId) => {
    socketRef.current?.emit('delete-message', { token: sessionTokenRef.current, messageId })
    setReactionPickerForMessageId(null)
  }

  const handlePhotoButtonClick = () => {
    photoFileInputRef.current?.click()
  }

  const handlePhotoFileSelected = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // aynı dosyayı üst üste seçebilsin diye
    sendPhotoFile(file)
  }

  // YENİ: Mesaj kutusuna Ctrl+V ile bir fotoğraf yapıştırılırsa,
  // normal metin yapıştırma yerine fotoğraf gönderme akışını başlatıyoruz.
  const handleChatInputPaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault() // metin kutusuna resmin dosya adı vs. yapıştırılmasın
        const file = item.getAsFile()
        if (file) sendPhotoFile(file)
        return
      }
    }
    // Görsel yoksa hiçbir şey yapmıyoruz — normal metin yapıştırma
    // (tarayıcının kendi varsayılan davranışı) olduğu gibi devam eder.
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
        <img src={logoUrl} alt="Disco" className="app-logo app-logo--login" />
        <h1>Disco</h1>
        {authMode === 'login' ? (
          <>
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
            {registerSuccessMessage && <p className="register-success-text">{registerSuccessMessage}</p>}
            <p className="name-entry-hint">
              Hesabın yok mu?{' '}
              <button
                type="button"
                className="auth-mode-link"
                onClick={() => {
                  setAuthMode('register')
                  setLoginError(null)
                  setRegisterSuccessMessage(null)
                }}
              >
                Kayıt ol
              </button>
            </p>
          </>
        ) : (
          <>
            <p>Davet koduyla kayıt ol:</p>
            <form onSubmit={handleRegister}>
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
                  placeholder="Şifre (en az 6 karakter)"
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
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Davet kodu"
              />
              <button type="submit" disabled={isRegistering}>
                {isRegistering ? 'Kayıt olunuyor…' : 'Kayıt Ol'}
              </button>
            </form>
            {registerError && <p className="error-text">{registerError}</p>}
            <p className="name-entry-hint">
              Zaten hesabın var mı?{' '}
              <button
                type="button"
                className="auth-mode-link"
                onClick={() => {
                  setAuthMode('login')
                  setRegisterError(null)
                }}
              >
                Giriş yap
              </button>
            </p>
          </>
        )}
        <ZoomControl
        zoomLevel={zoomLevel}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={zoomReset}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
      </div>
    )
  }

  // YENİ: Mesajlar (kalıcı) ve fotoğrafları (geçici) tek bir zaman
  // çizelgesinde, zaman sırasına göre birleştiriyoruz — sohbette
  // ikisi de aynı akışta görünsün diye.
  const chatTimeline = [
    ...messages.map((m) => ({ ...m, kind: 'text' })),
    ...ephemeralPhotos.map((p) => ({ ...p, kind: 'photo' })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  return (
    <div className="app-shell">
      <aside className="channel-sidebar">
        <div className="sidebar-brand">
          <img src={logoUrl} alt="Disco" className="app-logo app-logo--sidebar" />
          <h1 className="app-title">Disco</h1>
        </div>
        <p className="whoami">{displayName} olarak bağlısın</p>
        <nav className="channel-list">
          {channels.map((channel) => {
            const hasUnread = unreadChannels.includes(channel)
            const isVoiceHere = voiceChannel === channel
            return (
              <button
                key={channel}
                className={
                  'channel-button' + (activeChannel === channel ? ' channel-button--active' : '')
                }
                onClick={() => joinChannel(channel)}
              >
                # {channel}
                {/* YENİ: sesin hangi kanalda olduğunu, o kanalı görüntülemesen
                    bile listede görebilesin diye. */}
                {isVoiceHere && <span className="channel-voice-indicator">🎙️</span>}
                {hasUnread && <span className="channel-unread-dot" />}
              </button>
            )
          })}
        </nav>

        {/* YENİ: kanalların hizasında, sabit (her zaman görünür) genel
            ayarlar düğmesi — sesteki ⚙️'den FARKLI: o sadece o anki ses
            görüşmesinin mikrofon/hoparlör seçimiydi, bu ise kalıcı,
            hesap/uygulama genelindeki kişiselleştirme ayarları için. */}
        <button
          type="button"
          className="app-settings-button"
          onClick={() => setShowAppSettings(true)}
        >
          ⚙️ Ayarlar
        </button>
      </aside>

      <main className="main-panel">
        {connectionError && (
          <div className="no-channel-placeholder">
            <p className="error-text">{connectionError}</p>
          </div>
        )}

        {!activeChannel && !connectionError && (
          <div className="no-channel-placeholder">
            <p>Başlamak için soldan bir kanal seç.</p>
          </div>
        )}

        {activeChannel && !connectionError && (
          <div className="channel-view">
            {connectionStatus === 'reconnecting' && (
              <div className="reconnecting-banner">🔄 Bağlantı koptu, yeniden bağlanılıyor…</div>
            )}

            <div className="channel-main">
              <div className="channel-header">
                <h2># {activeChannel}</h2>
                <div className="channel-header-actions">
                  {/* YENİ: sesteyken BAŞKA bir kanala bakıyorsan burada ne
                      "Sese Katıl" (zaten sestesin, başka kanalda ses
                      açılamaz) ne de "Sesten Çık" (bu kanalın sesi değil ki)
                      gösteriyoruz — onun yerine aşağıdaki banner var. */}
                  {!inVoice && (
                    <button className="join-voice-button" onClick={joinVoice}>
                      📞 Sese Katıl
                    </button>
                  )}
                  {inVoice && voiceChannel === activeChannel && (
                    <button className="leave-voice-button" onClick={leaveVoice}>
                      📞 Sesten Çık
                    </button>
                  )}
                  <button className="leave-button" onClick={leaveChannel}>
                    Kanaldan Ayrıl
                  </button>
                </div>
              </div>

              {/* YENİ: sesli sohbet BAŞKA bir kanaldayken (ör. #Genel'de
                  sesteyken #Cereyancılar'ın mesajlarına bakıyorsun), sesin
                  kesilmediğini hatırlatan ve geri dönüş imkânı veren
                  kalıcı bir şerit. */}
              {inVoice && voiceChannel && voiceChannel !== activeChannel && (
                <div className="voice-elsewhere-banner">
                  <span>
                    🎙️ Sesli sohbettesin: <strong># {voiceChannel}</strong>
                  </span>
                  <div className="voice-elsewhere-banner-actions">
                    <button onClick={() => joinChannel(voiceChannel)}>Kanala dön</button>
                    <button
                      className={
                        'control-button control-button--small' +
                        (isMicOn ? '' : ' control-button--off')
                      }
                      onClick={toggleMic}
                      title={isMicOn ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
                    >
                      {isMicOn ? '🎤' : '🔇'}
                    </button>
                    <button onClick={leaveVoice}>Sesten çık</button>
                  </div>
                </div>
              )}

              {inVoice && voiceChannel === activeChannel && (
                <div className={'video-grid' + (enlargedTile ? ' video-grid--has-enlarged' : '')}>
                  {/* YENİ: büyütülmüş kutucuk artık gerçek bir lightbox —
                      arkasına tıklayınca da küçülsün diye karartma katmanı. */}
                  {enlargedTile && (
                    <div
                      className="enlarged-tile-backdrop"
                      onClick={() => setEnlargedTile(null)}
                    />
                  )}
                  {mediaError && <p className="error-text">{mediaError}</p>}

                  <div
                    className={
                      'video-tile local-media-panel' +
                      (enlargedTile === 'local-camera' ? ' video-tile--enlarged' : '')
                    }
                    onClick={() => toggleEnlarge('local-camera')}
                  >
                    {enlargedTile === 'local-camera' && (
                      <button
                        className="enlarged-tile-close"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleEnlarge('local-camera')
                        }}
                        title="Küçült"
                      >
                        ✕
                      </button>
                    )}
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
                        {myAvatar ? (
                          <img src={myAvatar} alt="" className="avatar-circle avatar-circle--photo" />
                        ) : (
                          <div className="avatar-circle">{displayName.charAt(0).toUpperCase()}</div>
                        )}
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
                        className={'control-button' + (isDeafened ? ' control-button--off' : '')}
                        onClick={toggleDeafen}
                        title={isDeafened ? 'Sağırlığı kaldır' : 'Sağırlaştır (herkesi sustur)'}
                      >
                        {isDeafened ? '🔇' : '🎧'}
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
                    </div>
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
                      {enlargedTile === 'local-screen' && (
                        <button
                          className="enlarged-tile-close"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleEnlarge('local-screen')
                          }}
                          title="Küçült"
                        >
                          ✕
                        </button>
                      )}
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
                            onOpenVolumeMenu={(e) => label && openVolumePopup(label, e)}
                            ping={peerPings[socketId]}
                            avatarUrl={peer?.avatarData}
                          />
                        )}
                        {peer?.sharingScreen && streams.screenStream && (
                          <RemoteScreenTile
                            stream={streams.screenStream}
                            label={label}
                            isEnlarged={enlargedTile === `${socketId}-screen`}
                            onToggleEnlarge={() => toggleEnlarge(`${socketId}-screen`)}
                            outputDeviceId={selectedAudioOutput}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="chat-panel">
                <div
                  className={'chat-messages' + (isDraggingPhoto ? ' chat-messages--dragging' : '')}
                  ref={chatMessagesRef}
                  onDragOver={handleChatDragOver}
                  onDragLeave={handleChatDragLeave}
                  onDrop={handleChatDrop}
                >
                  {isDraggingPhoto && (
                    <div className="chat-drop-hint">📷 Bırak, gönderilsin</div>
                  )}
                  {chatTimeline.length === 0 && (
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
                  {chatTimeline.map((item, i) =>
                    item.kind === 'photo' ? (
                      <div key={`photo-${i}`} className="chat-message chat-message--photo">
                        <span className="chat-message-author">{item.username}</span>
                        <img
                          src={item.imageData}
                          alt="Paylaşılan fotoğraf"
                          className="chat-photo"
                          onClick={() => window.open(item.imageData, '_blank')}
                        />
                        <span className="chat-photo-hint">📷 tek seferlik — kaydedilmiyor</span>
                      </div>
                    ) : (
                      <div
                        key={item.id || `text-${i}`}
                        className="chat-message chat-message--text-wrap"
                        onContextMenu={(e) => item.id && handleMessageContextMenu(e, item.id)}
                      >
                        {editingMessageId === item.id ? (
                          // YENİ: düzenleme modu — metni doğrudan burada değiştir.
                          <div className="chat-message-edit-row" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmitEdit(item.id)
                                if (e.key === 'Escape') handleCancelEdit()
                              }}
                              autoFocus
                              maxLength={2000}
                            />
                            <button type="button" onClick={() => handleSubmitEdit(item.id)}>
                              ✓
                            </button>
                            <button type="button" onClick={handleCancelEdit}>
                              ✕
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="chat-message-author">{item.username}</span>
                            <span className="chat-message-time">
                              {formatMessageTime(item.createdAt)}
                              {item.editedAt && ' (düzenlendi)'}
                            </span>
                            <button
                              type="button"
                              className="chat-message-copy"
                              title="Metni kopyala"
                              onClick={() => navigator.clipboard?.writeText(item.text)}
                            >
                              📋
                            </button>
                            <span className="chat-message-text">
                              {renderMessageTextWithMentions(item.text, displayName)}
                            </span>
                          </>
                        )}
                        {item.id &&
                          (item.reactions?.length > 0 ||
                            reactionPickerForMessageId === item.id) && (
                          <div className="chat-reactions" onClick={(e) => e.stopPropagation()}>
                            {Object.entries(
                              (item.reactions || []).reduce((acc, r) => {
                                acc[r.emoji] = acc[r.emoji] || []
                                acc[r.emoji].push(r.username)
                                return acc
                              }, {})
                            ).map(([emoji, usernames]) => (
                              <button
                                key={emoji}
                                type="button"
                                className={
                                  'reaction-pill' +
                                  (usernames.includes(displayName) ? ' reaction-pill--mine' : '')
                                }
                                onClick={() => handleToggleReaction(item.id, emoji)}
                                title={usernames.join(', ')}
                              >
                                {emoji} {usernames.length}
                              </button>
                            ))}
                            {reactionPickerForMessageId === item.id && (
                              <div className="reaction-picker reaction-picker--open">
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className="reaction-picker-option"
                                    onClick={() => {
                                      handleToggleReaction(item.id, emoji)
                                      setReactionPickerForMessageId(null)
                                    }}
                                >
                                  {emoji}
                                </button>
                              ))}
                              {/* YENİ: silme artık kendi mesajınla sınırlı değil —
                                  Alganis rolündeki hesaplar BAŞKASININ mesajını da
                                  tek tıkla silebiliyor (moderasyon). Düzenleme
                                  hâlâ sadece kendi mesajın için. */}
                              {(item.username === displayName || isAdmin) && (
                                <span className="reaction-picker-divider" />
                              )}
                              {item.username === displayName && (
                                <button
                                  type="button"
                                  className="reaction-picker-option"
                                  title="Düzenle"
                                  onClick={() => handleStartEdit(item)}
                                >
                                  ✏️
                                </button>
                              )}
                              {(item.username === displayName || isAdmin) && (
                                <button
                                  type="button"
                                  className="reaction-picker-option"
                                  title="Sil"
                                  onClick={() => handleDeleteMessage(item.id)}
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  )}
                  {typingUsers.length > 0 && (
                    <p className="chat-typing-indicator">
                      {typingUsers.join(', ')} yazıyor…
                    </p>
                  )}
                </div>
                <form className="chat-input-form" onSubmit={handleSendMessage}>
                  <input
                    ref={photoFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handlePhotoFileSelected}
                  />
                  <button
                    type="button"
                    className="chat-photo-button"
                    onClick={handlePhotoButtonClick}
                    disabled={isSendingPhoto}
                    title="Fotoğraf paylaş (kaydedilmez, sadece anlık)"
                  >
                    {isSendingPhoto ? '…' : '📷'}
                  </button>
                  <div className="chat-input-wrapper">
                    {/* YENİ: @ yazarken üye önerisi — mesajın sonuna
                        birini ya da @all'ı kolayca etiketleyebilesin diye. */}
                    {mentionCandidates.length > 0 && (
                      <div className="mention-suggestions">
                        {mentionCandidates.map((c) => (
                          <button
                            key={c.username}
                            type="button"
                            className="mention-suggestion-option"
                            onMouseDown={(e) => {
                              e.preventDefault() // input'un focus'unu kaybetmesin
                              insertMention(c.username)
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={handleChatInputChange}
                      onPaste={handleChatInputPaste}
                      placeholder="Mesaj yaz… (fotoğraf yapıştırabilirsin, @ ile etiketleyebilirsin)"
                      maxLength={2000}
                    />
                  </div>
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
                    <li
                      key={m.username}
                      className="member-item member-item--online"
                      onContextMenu={(e) => m.username !== displayName && openVolumePopup(m.username, e)}
                      title={m.username !== displayName ? 'Ses seviyesini ayarlamak için sağ tıkla' : undefined}
                    >
                      <span className="member-status-dot member-status-dot--online" />
                      {m.avatarData ? (
                        <img src={m.avatarData} alt="" className="member-item-avatar" />
                      ) : (
                        <span className="member-item-avatar member-item-avatar--empty">
                          {m.username.charAt(0).toUpperCase()}
                        </span>
                      )}
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
                      <li
                        key={m.username}
                        className="member-item member-item--offline"
                        onContextMenu={(e) => openVolumePopup(m.username, e)}
                        title="Ses seviyesini ayarlamak için sağ tıkla"
                      >
                        <span className="member-status-dot member-status-dot--offline" />
                        {m.avatarData ? (
                          <img src={m.avatarData} alt="" className="member-item-avatar" />
                        ) : (
                          <span className="member-item-avatar member-item-avatar--empty">
                            {m.username.charAt(0).toUpperCase()}
                          </span>
                        )}
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

      {volumePopup && (
        <div
          className="volume-popup volume-popup--floating"
          style={{ left: volumePopup.x, top: volumePopup.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="volume-popup-header">
            <span>{volumePopup.username} — ses seviyesi</span>
            <button className="volume-popup-close" onClick={() => setVolumePopup(null)}>
              ✕
            </button>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            value={peerVolumes[volumePopup.username] ?? 100}
            onChange={(e) => setPeerVolume(volumePopup.username, Number(e.target.value))}
          />
          <div className="volume-popup-value">{peerVolumes[volumePopup.username] ?? 100}%</div>
        </div>
      )}

      <ZoomControl
        zoomLevel={zoomLevel}
        onZoomOut={zoomOut}
        onZoomIn={zoomIn}
        onReset={zoomReset}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* YENİ: genel/kalıcı ayarlar penceresi — şimdilik sadece
          kişiselleştirme (renk teması), ileride büyüyecek bir yer. */}
      {showAppSettings && (
        <div
          className="app-settings-backdrop"
          onClick={() => setShowAppSettings(false)}
        >
          <div className="app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-settings-modal-header">
              <h3>Ayarlar</h3>
              <button
                type="button"
                className="app-settings-close"
                onClick={() => setShowAppSettings(false)}
              >
                ✕
              </button>
            </div>
            <section className="app-settings-section">
              <h4>Profil</h4>
              <div className="avatar-picker-row">
                {myAvatar ? (
                  <img src={myAvatar} alt="" className="avatar-picker-preview" />
                ) : (
                  <div className="avatar-picker-preview avatar-picker-preview--empty">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleAvatarFileSelected}
                  />
                  <button
                    type="button"
                    className="device-settings-test-button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                  >
                    {isUploadingAvatar ? 'Yükleniyor…' : '🖼️ Profil fotoğrafı seç'}
                  </button>
                  {avatarUploadError && (
                    <p className="device-settings-error">{avatarUploadError}</p>
                  )}
                </div>
              </div>
            </section>
            <section className="app-settings-section">
              <h4>Ses Cihazları</h4>
              <label>
                🎤 Mikrofon
                <select
                  value={selectedAudioInput}
                  onChange={(e) => setSelectedAudioInput(e.target.value)}
                >
                  <option value="">Varsayılan</option>
                  {audioInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Mikrofon'}
                    </option>
                  ))}
                </select>
              </label>
              {/* YENİ: mikrofon testi — konuşunca çubuğun hareket etmesi
                  lazım, mikrofonun gerçekten ses aldığını (ve doğru cihazın
                  seçili olduğunu) hoparlöre hiç bağlanmadan (yankı olmasın
                  diye) doğrulamak için. */}
              <div className="mic-test-row">
                <button type="button" className="device-settings-test-button" onClick={testMicrophone}>
                  {isTestingMic ? '⏹️ Testi durdur' : '🎤 Mikrofonu test et'}
                </button>
                {isTestingMic && (
                  <div className="mic-test-meter">
                    <div className="mic-test-meter-fill" style={{ width: `${micTestLevel}%` }} />
                  </div>
                )}
              </div>
              <label>
                🔊 Hoparlör
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => setSelectedAudioOutput(e.target.value)}
                >
                  <option value="">Varsayılan</option>
                  {audioOutputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Hoparlör'}
                    </option>
                  ))}
                </select>
              </label>
              {selectedAudioInput && (
                <p className="device-settings-hint">
                  Mikrofon değişikliği bir sonraki mikrofon açışında uygulanır.
                </p>
              )}
              {outputDeviceError && <p className="device-settings-error">{outputDeviceError}</p>}
              {/* YENİ: karşı taraf olmadan, sesli sohbetle AYNI çıkış yolunu
                  test etmek için — duyuyorsan sorun yönlendirmede değil,
                  duymuyorsan seçili cihaz/işletim sistemi tarafında. */}
              <button type="button" className="device-settings-test-button" onClick={playTestTone}>
                🔊 Test sesi çal
              </button>
            </section>

            <section className="app-settings-section">
              <h4>Bas Konuş</h4>
              <p className="app-settings-hint">
                Etkinleştirirsen mikrofonun sürekli açık olmaz — sadece
                atadığın tuşa bastığın sürece sesin gider.
              </p>
              <button type="button" className="device-settings-test-button" onClick={handleTogglePtt}>
                {pttEnabled ? `🎯 Bas-konuş: ${formatKeyCode(pttKey)} — kapat` : '🎯 Bas-konuşu etkinleştir'}
              </button>
              {isCapturingPttKey && (
                <p className="app-settings-hint">Bas-konuş için bir tuşa bas…</p>
              )}
            </section>

            <section className="app-settings-section">
              <h4>Kişiselleştirme</h4>
              <p className="app-settings-hint">Vurgu rengini seç — tüm arayüz buna göre boyanır.</p>
              <div className="theme-swatch-row">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={'theme-swatch' + (theme === t.id ? ' theme-swatch--active' : '')}
                    style={{ '--swatch-color': t.color }}
                    onClick={() => setTheme(t.id)}
                    title={t.label}
                  >
                    <span className="theme-swatch-dot" />
                    {t.label}
                  </button>
                ))}
              </div>
            </section>

            {/* YENİ: Alganis rolü için üye/rol yönetimi — sadece admin
                görüyor. Kayıtlı TÜM kullanıcılar (hiç çevrimiçi olmasalar
                bile) listelenip rol eklenip/çıkarılabiliyor. */}
            {isAdmin && (
              <section className="app-settings-section">
                <h4>Üye Yönetimi</h4>
                <p className="app-settings-hint">
                  Kayıtlı kullanıcılara rol ekle/çıkar (ör. bir kanala erişim vermek için).
                </p>
                {isLoadingUsers && <p className="app-settings-hint">Yükleniyor…</p>}
                {userManagementError && (
                  <p className="device-settings-error">{userManagementError}</p>
                )}
                <div className="user-management-list">
                  {allUsers.map((u) => (
                    <div key={u.username} className="user-management-row">
                      <span className="user-management-name">{u.username}</span>
                      <div className="user-management-roles">
                        {u.roles.map((role) => (
                          <span key={role} className="role-chip">
                            {role}
                            <button
                              type="button"
                              onClick={() => removeRoleFromUser(u.username, role)}
                              title="Rolü kaldır"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          className="role-input"
                          placeholder="+ rol"
                          value={roleInputByUser[u.username] || ''}
                          onChange={(e) =>
                            setRoleInputByUser((prev) => ({
                              ...prev,
                              [u.username]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addRoleToUser(u.username)
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
