import { useState, useRef, useCallback, useEffect } from 'react'
import { io } from 'socket.io-client'
import './App.css'
import logoUrl from './assets/logo.png'
import { EyeIcon } from './components/EyeIcon.jsx'
import { RemoteCameraTile } from './components/RemoteCameraTile.jsx'
import { RemoteScreenTile } from './components/RemoteScreenTile.jsx'
import { ZoomControl } from './components/ZoomControl.jsx'
import { SERVER_URL, QUICK_REACTIONS, DEFAULT_ICE_SERVERS, THEMES, IS_DESKTOP_APP } from './lib/config.js'
import { DEBUG, debugLog } from './lib/debug.js'
import { formatKeyCode, formatMessageTime, describeMediaError } from './lib/format.js'
import { renderMessageTextWithMentions } from './lib/mentions.jsx'
import { setEffectsOutputDevice, playMentionSound, playJoinSound, playLeaveSound, playMessageSound, playScreenShareSound } from './lib/sounds.js'
import { MEDIA_ROLES, ROLE_KINDS, transceiverRoles } from './lib/webrtc.js'

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
  // Web'de tarayıcının kendi yakınlaştırmasına dokunmuyoruz.
  useEffect(() => {
    if (!IS_DESKTOP_APP) return
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

  // YENİ: Discord tarzı otomatik güncelleme — gerçek indirme/kurulum
  // Electron main process'te (electron-updater) oluyor, biz sadece
  // durumu dinleyip küçük bir bildirim gösteriyoruz.
  const [updateInfo, setUpdateInfo] = useState(null) // { version } | null
  const [updateProgress, setUpdateProgress] = useState(null) // 0-100 | null
  const [updateReady, setUpdateReady] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [updateCheckMessage, setUpdateCheckMessage] = useState(null)
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => setAppVersion(v || ''))
  }, [])
  useEffect(() => {
    const unsubAvailable = window.electronAPI?.onUpdateAvailable?.((info) => {
      setUpdateInfo(info)
      setUpdateCheckMessage(null)
    })
    const unsubNotAvailable = window.electronAPI?.onUpdateNotAvailable?.(() => {
      setUpdateCheckMessage('En güncel sürümü kullanıyorsun.')
    })
    const unsubProgress = window.electronAPI?.onUpdateDownloadProgress?.(({ percent }) => {
      setUpdateProgress(percent)
    })
    const unsubDownloaded = window.electronAPI?.onUpdateDownloaded?.((info) => {
      setUpdateInfo(info)
      setUpdateReady(true)
      setUpdateProgress(null)
    })
    const unsubError = window.electronAPI?.onUpdateError?.((message) => {
      console.error('[güncelleme] hata:', message)
      setUpdateCheckMessage('Güncelleme kontrol edilemedi, tekrar dener misin?')
    })
    return () => {
      unsubAvailable?.()
      unsubNotAvailable?.()
      unsubProgress?.()
      unsubDownloaded?.()
      unsubError?.()
    }
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

  // YENİ: Güvenlik — banlı IP listesi + anlık güvenlik uyarıları
  // (bkz. "Güvenlik" bölümü, Ayarlar panelinde, sadece isAdmin).
  const [bannedIps, setBannedIps] = useState([])
  const [isLoadingBannedIps, setIsLoadingBannedIps] = useState(false)
  const [securityAlert, setSecurityAlert] = useState(null) // { ip, attemptCount, reason } | null

  // --- Kişisel hesap girişi ---
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const displayName = username
  // Kanal soketinin dinleyicileri kanala girerken bir kez kuruluyor ve o
  // anki değerleri hatırlıyor; güncel adı oradan bu ref ile okuyoruz.
  // Eskiden ilk açılıştaki boş adı görüyorlardı: kendi mesajında bildirim
  // sesi çalıyor, @adın geçince özel ses çalmıyordu (H9).
  const displayNameRef = useRef(displayName)
  useEffect(() => {
    displayNameRef.current = displayName
  }, [displayName])

  // YENİ: "Beni hatırla" — işaretlenirse giriş belirteci localStorage'da
  // saklanıp bir dahaki açılışta otomatik oturum devam ettiriliyor (bkz.
  // aşağıdaki "oturumu geri yükle" efekti). isRestoringSession, uygulama
  // İLK açıldığında bunu deneyip denemediğimizi (ve hâlâ sürüyorsa)
  // takip ediyor — böylece kayıtlı bir oturumu olan biri KISA bir an
  // için bile giriş ekranını görmüyor.
  const [rememberMe, setRememberMe] = useState(false)
  const [isRestoringSession, setIsRestoringSession] = useState(
    () => !!window.localStorage?.getItem('rememberedSessionToken')
  )

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

  // YENİ: ÇOKLU SUNUCU — kanal listesi artık AKTİF SUNUCUYA bağlı (bkz.
  // fetchServerChannels), her öğe {id, name} — id, oda/DB anahtarı olarak
  // kullanılan kanalın ObjectId'si. myServers, giriş yapan kullanıcının
  // erişebildiği sunucuların listesi ({id, name, isOwner}).
  const [channels, setChannels] = useState([])
  const [myServers, setMyServers] = useState([])
  const [activeServerId, setActiveServerId] = useState(
    () => window.localStorage?.getItem('activeServerId') || null
  )
  const activeServerIdRef = useRef(activeServerId)
  useEffect(() => {
    activeServerIdRef.current = activeServerId
  }, [activeServerId])
  // YENİ: sunucu oluştur/katıl modalı.
  const [showServerModal, setShowServerModal] = useState(false)
  const [serverModalTab, setServerModalTab] = useState('create') // 'create' | 'join'
  const [newServerName, setNewServerName] = useState('')
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [serverModalError, setServerModalError] = useState(null)
  const [serverModalBusy, setServerModalBusy] = useState(false)
  // YENİ: sunucu davet kodu popover'ı (sadece sahibiyken açılabiliyor).
  const [serverInvitePopover, setServerInvitePopover] = useState(null) // { code } | null
  // YENİ: "Sunucu Üyeleri" (Ayarlar > sadece aktif sunucunun sahibiyken).
  const [serverMembers, setServerMembers] = useState([])

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
  const voiceChannelRef = useRef(null)
  useEffect(() => {
    voiceChannelRef.current = voiceChannel
  }, [voiceChannel])
  const [connectionError, setConnectionError] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('connected')
  // Kısa süreli bilgi şeridi (ör. "Bu sunucudan çıkarıldın.") — 8 saniyede
  // kendiliğinden kapanıyor.
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])
  // Kanal soketindeki 'server-list-changed' dinleyicisi, daha aşağıda
  // tanımlanan liste yenileme fonksiyonlarına bu ref üzerinden ulaşıyor.
  const refreshServerDataRef = useRef(null)
  // Aynısı, Ayarlar'daki "Sunucu Üyeleri" listesi için (sadece açıkken).
  const refreshServerMembersRef = useRef(null)
  // Aynısı, sağdaki üye listesi (kim çevrimiçi, kim seste) için.
  const refreshPresenceRef = useRef(null)

  // YENİ: üye listesi (Discord tarzı, sağda) — online (metin kanalına
  // bağlı herkes, seste olanlar ayrıca işaretli) + offline (daha önce
  // bu kanala girmiş ama şu an bağlı olmayanlar).
  const [onlineMembers, setOnlineMembers] = useState([])
  const [offlineMembers, setOfflineMembers] = useState([])

  // YENİ: mobil düzen — kanal listesi ve üye listesi dar ekranlarda
  // yatay kaydırma/yatay çevirme gerektirmesin diye kaydırmalı
  // çekmecelere (drawer) dönüşüyor, bu ikisi onların açık/kapalı
  // durumunu tutuyor.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileMembersOpen, setMobileMembersOpen] = useState(false)

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
    setEffectsOutputDevice(selectedAudioOutput)
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
  // Sohbetteki fotoğrafın büyütülmüş hâli (uygulama içinde). Eskiden
  // window.open ile açılıyordu: masaüstünde çıplak bir Electron penceresi,
  // web'de hiçbir şey (tarayıcılar data: adreslerini açmıyor).
  const [photoLightbox, setPhotoLightbox] = useState(null) // data URL | null
  useEffect(() => {
    if (!photoLightbox) return
    const handleEscape = (e) => {
      if (e.key === 'Escape') setPhotoLightbox(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [photoLightbox])
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
    debugLog(
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
        // Ana bağlantıda tek ses alıcısı var (bkz. startMainConnection);
        // karşı taraf mikrofonunu açınca aynı ize veri akmaya başlıyor.
        const audioTrack = streams.mainStream?.getAudioTracks()[0]
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
          debugLog(
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

  // Uygulama başına TEK bağlantı: açılışta kuruluyor, uygulama kapanana
  // kadar açık kalıyor. Giriş, kanallar, ses ve bütün istekler bundan
  // gidiyor; her (yeniden) bağlanışta oturum anahtarı el sıkışmada
  // gönderiliyor ve sunucu bağlantıyı bize bağlıyor. Eskiden her kanal için
  // ayrı, her istek (giriş, sunucu listesi…) için de geçici bir bağlantı
  // açılıyordu. Olay dinleyicileri aşağıda, joinChannel'ın yanında.
  const socketRef = useRef(null)
  useEffect(() => {
    const socket = io(SERVER_URL, {
      auth: (callback) => callback({ token: sessionTokenRef.current }),
    })
    socketRef.current = socket
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])
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

  // peerConnectionsRef: Map<peerSocketId, { mainPc }>
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
                debugLog(
                  `[ICE seçilen yol] ${peerSocketId} yerel: ${candidateTypes.get(report.localCandidateId)}, karşı: ${candidateTypes.get(report.remoteCandidateId)}`
                )
              }
              // YENİ (teşhis): ses verisi GERÇEKTEN gidiyor/geliyor mu?
              if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                debugLog(
                  `[ses teşhis] ${peerSocketId} GÖNDERİLEN ses: ${report.bytesSent} bayt, ${report.packetsSent} paket`
                )
              }
              if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                debugLog(
                  `[ses teşhis] ${peerSocketId} ALINAN ses: ${report.bytesReceived} bayt, ${report.packetsReceived} paket`
                )
              }
            })
          } catch {
            // Bağlantı henüz tam kurulmamış olabilir — bir sonraki turda tekrar dener.
          }
        }

        // YENİ (teşhis): mikrofon sesi için kurduğumuz Web Audio grafiğinde
        // (AnalyserNode) GERÇEKTEN sinyal var mı? bytesReceived artıyor
        // olsa bile, bu grafikte 0 çıkıyorsa sorun kesinlikle GainNode
        // bağlantısı/AudioContext tarafında demektir; burada da 0 çıkıp bir
        // de duyulmuyorsa ve bytesReceived artıyorsa, gelen ses GERÇEKTEN
        // sessiz olabilir (karşı taraf konuşurken bile).
        const analyser = analysersRef.current.get(peerSocketId)
        if (DEBUG && analyser) {
          const data = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i] - 128)
            if (v > peak) peak = v
          }
          debugLog(
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

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach(({ mainPc }) => {
      if (mainPc) mainPc.close()
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
      stopLocalMedia()
      cleanupPeerConnections()
    }
  }, [stopLocalMedia, cleanupPeerConnections])

  // Karşı tarafın akışlarını bağlantının alıcı izlerinden kuruyor: kamera
  // akışı (mikrofon + kamera) ve ekran akışı (ekran görüntüsü + ekran
  // sesi). Kanallar sabit olduğu için izler bağlantı boyunca değişmiyor.
  const syncReceiversToStream = useCallback((pc, peerSocketId) => {
    const roles = transceiverRoles(pc)
    if (!roles) return
    const mainTracks = [roles.mic, roles.camera].map((t) => t.receiver.track)
    const screenTracks = [roles.screen, roles.screenAudio].map((t) => t.receiver.track)
    setRemoteStreams((prev) => {
      const current = prev[peerSocketId]?.mainStream
      if (current && mainTracks.every((track) => current.getTracks().includes(track))) return prev
      return {
        ...prev,
        [peerSocketId]: {
          mainStream: new MediaStream(mainTracks),
          screenStream: new MediaStream(screenTracks),
        },
      }
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
        syncReceiversToStream(pc, peerSocketId)
      }
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          // YENİ (teşhis): toplanan her adayın TÜRünü (host/srflx/relay)
          // logluyoruz — "relay" hiç görünmüyorsa TURN sunucusuna hiç
          // ulaşılamıyor demektir (yanlış URL, kapalı port, geçersiz
          // kimlik bilgisi); "relay" görünüyor ama bağlantı yine de
          // kurulamıyorsa sorun başka bir yerde.
          debugLog(
            `[ICE aday] ${peerSocketId}/${connectionType} tür: ${event.candidate.type}, protokol: ${event.candidate.protocol}`
          )
          socketRef.current.emit('signal', {
            to: peerSocketId,
            data: { type: 'ice-candidate', candidate: event.candidate, connectionType },
          })
        }
      }
      pc.onconnectionstatechange = () => {
        debugLog(`[WebRTC ${peerSocketId}/${connectionType}] durum: ${pc.connectionState}`)
        // Ağ değişince (Wi-Fi'den mobil veriye geçmek gibi) bağlantı
        // "failed" olabiliyor; başlatan taraf ICE'yi yeniden başlatıp yeni
        // bir yol arıyor (teklif negotiationneeded ile kendiliğinden gider).
        if (pc.connectionState === 'failed' && pc.isInitiator) pc.restartIce()
      }
      // YENİ (teşhis): connectionState DTLS+ICE'yi birlikte özetliyor —
      // sadece ICE'nin kendisinin (NAT geçişi) başarılı olup olmadığını
      // ayrı görmek için iceConnectionState'i de ayrıca logluyoruz.
      // "failed" görürsen bu, TURN gerekiyordu ama kullanılamadı demektir.
      pc.oniceconnectionstatechange = () => {
        debugLog(
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

  const getPeerEntry = useCallback((peerSocketId) => {
    let entry = peerConnectionsRef.current.get(peerSocketId)
    if (!entry) {
      entry = { mainPc: null }
      peerConnectionsRef.current.set(peerSocketId, entry)
    }
    return entry
  }, [])

  // ANA BAĞLANTI: her eşle TEK bağlantı ve SABİT dört kanal (bkz.
  // MEDIA_ROLES): mikrofon, kamera, ekran görüntüsü, ekran sesi. Açıp
  // kapamak yeni kanal eklemiyor, sadece kanalın izini değiştiriyor
  // (replaceTrack), yeniden pazarlık da gerekmiyor. Eskiden iki taraf da
  // kendi "sadece al" kanallarını ekliyor, her aç-kapa yenilerini
  // doğuruyordu; karşı tarafta aynı türden birden çok iz birikiyor ve
  // uygulama veri taşımayanı seçiyordu (H30, H3). Ekran paylaşımı da her
  // eşle ayrı bir bağlantıydı: biri durdurunca karşı tarafın paylaşımı da
  // kopuyor, sonradan sese gireni kimse bağlamıyordu (H31).
  //
  // Kanalları sadece bağlantıyı BAŞLATAN taraf ekliyor: sese yeni biri
  // girince, zaten seste olanlar (bkz. 'voice-user-joined'). Karşı taraf
  // aynı kanalları teklifle birlikte alıyor ve kendi izlerini onlara
  // takıyor (bkz. attachLocalMedia, 'signal' içinde).
  const attachLocalMedia = useCallback((pc) => {
    const roles = transceiverRoles(pc)
    if (!roles) return
    const main = localMainStreamRef.current
    const screen = localScreenStreamRef.current
    const tracks = {
      mic: main?.getAudioTracks()[0],
      camera: main?.getVideoTracks()[0],
      screen: screen?.getVideoTracks()[0],
      screenAudio: screen?.getAudioTracks()[0],
    }
    for (const role of MEDIA_ROLES) {
      const transceiver = roles[role]
      if (transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv'
      const track = tracks[role] ?? null
      if (transceiver.sender.track !== track) {
        transceiver.sender.replaceTrack(track).catch((err) => {
          console.error(`[replaceTrack] ${role} hata:`, err)
        })
      }
    }
  }, [])

  const startMainConnection = useCallback(
    (peerSocketId) => {
      const entry = getPeerEntry(peerSocketId)
      if (entry.mainPc) return entry.mainPc
      const pc = createSubConnection(peerSocketId, 'main')
      pc.isInitiator = true
      MEDIA_ROLES.forEach((role) => pc.addTransceiver(ROLE_KINDS[role], { direction: 'sendrecv' }))
      attachLocalMedia(pc)
      entry.mainPc = pc
      syncReceiversToStream(pc, peerSocketId)
      return pc
    },
    [getPeerEntry, createSubConnection, attachLocalMedia, syncReceiversToStream]
  )

  // Teklifi alan taraf: kanallar setRemoteDescription ile oluşuyor.
  const acceptMainConnection = useCallback(
    (peerSocketId) => {
      const entry = getPeerEntry(peerSocketId)
      if (!entry.mainPc) entry.mainPc = createSubConnection(peerSocketId, 'main')
      return entry.mainPc
    },
    [getPeerEntry, createSubConnection]
  )

  // Mikrofon, kamera ya da ekran açılıp kapanınca bütün bağlantılarda o
  // rolün kanalına yeni izi (kapatırken null) takıyor.
  const setLocalTrackOnMainConnections = useCallback((role, track) => {
    peerConnectionsRef.current.forEach(({ mainPc }, peerSocketId) => {
      const transceiver = mainPc && transceiverRoles(mainPc)?.[role]
      if (!transceiver) return
      transceiver.sender.replaceTrack(track ?? null).catch((err) => {
        console.error(`[replaceTrack] ${peerSocketId} - ${role} hata:`, err)
      })
      debugLog(`[replaceTrack] ${peerSocketId} - ${role} ${track ? 'açıldı' : 'kapandı'}`)
    })
  }, [])

  // Ses durumunu YERELDE sıfırlar: mikrofon, kamera ve ekran paylaşımı
  // kapanır, eş bağlantıları ve ses düğümleri temizlenir. Sunucuya haber
  // vermez (bkz. leaveVoice); sunucunun bizi zaten sesten çıkardığı
  // durumlarda da (kanal hatası, başka cihazdan sese girme) kullanılıyor.
  const resetVoiceState = useCallback(() => {
    stopLocalMedia()
    cleanupPeerConnections()
    setPeers([])
    setIsMicOn(false)
    setIsCameraOn(false)
    setIsScreenSharing(false)
    setEnlargedTile(null)
    setInVoice(false)
    setVoiceChannel(null)
    voiceChannelRef.current = null
    setVolumePopup(null)
    setIsDeafened(false)
    // Ses seviyesi düğümleri bir sonraki sese girişte sıfırdan kurulacak.
    gainNodesRef.current.forEach((gainNode) => gainNode.disconnect())
    gainNodesRef.current.clear()
    connectedAudioTracksRef.current.clear()
  }, [stopLocalMedia, cleanupPeerConnections])

  // YENİ: Sesten çık — metin kanalında KALMAYA devam ediyoruz, sadece
  // WebRTC/medya bağlantılarını kapatıyoruz.
  const leaveVoice = useCallback(() => {
    socketRef.current?.emit('leave-voice')
    resetVoiceState()
  }, [resetVoiceState])

  // Sunucuya (yeniden) duyurulan kendi ses durumumuz.
  const currentVoiceState = useCallback(() => {
    const audioTrack = localMainStreamRef.current?.getAudioTracks()[0]
    return {
      muted: !(audioTrack && audioTrack.enabled),
      cameraOn: !!localMainStreamRef.current?.getVideoTracks()[0],
      sharingScreen: !!localScreenStreamRef.current,
    }
  }, [])

  // YENİ: Sese katıl — metin kanalına ZATEN girmiş olmamız lazım. Hangi
  // kanaldayken katıldıysak (activeChannelRef.current), ses O kanala
  // bağlanıyor — sonradan başka bir kanalın mesajlarına göz atsan bile
  // ses hep bu kanalda kalır.
  const joinVoice = useCallback(() => {
    if (!socketRef.current) return
    socketRef.current.emit('join-voice', {
      token: sessionTokenRef.current,
      channelId: activeChannelRef.current,
    })
    setInVoice(true)
    setVoiceChannel(activeChannelRef.current)
    voiceChannelRef.current = activeChannelRef.current
  }, [])

  // İnternet bir an gidip gelince sunucu bizi sesten çıkarmış oluyor ve
  // eski eş bağlantıları kopmuş bağlantıya ait (karşı taraf da onları
  // kapattı). Yeniden bağlanınca sese kendiliğinden geri dönüyoruz;
  // mikrofon, kamera ve ekran olduğu gibi kalıyor, yeni bağlantılara
  // takılıyor. Sunucu reddederse (ör. kanala erişim kalmadıysa) sesi
  // yerelde de kapatıyoruz.
  const rejoinVoice = useCallback(
    (socket) => {
      cleanupPeerConnections()
      setPeers([])
      socket.emit(
        'join-voice',
        {
          token: sessionTokenRef.current,
          channelId: voiceChannelRef.current,
          state: currentVoiceState(),
        },
        (response) => {
          if (!response?.success) resetVoiceState()
        }
      )
    },
    [cleanupPeerConnections, currentVoiceState, resetVoiceState]
  )

  const leaveChannel = useCallback(() => {
    socketRef.current?.emit('leave-channel')
    resetVoiceState()
    activeChannelRef.current = null
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
  }, [resetVoiceState])

  // Kanala (METİN) girme — ses bağlantısı burada HİÇ kurulmuyor. Kanal
  // değiştirmek bağlantıya ve sese dokunmuyor: sadece hangi kanalın
  // mesajlarını izlediğimiz değişiyor. Sesteysek ses olduğu kanalda
  // (voiceChannel) kalıyor, başka kanalın mesajlarına göz atılabiliyor.
  // Bağlantı o an yeniden kuruluyorsa istek bekliyor, bağlanınca gidiyor.
  const joinChannel = useCallback((channelId) => {
    // Zaten açık olan kanala tıklamak hiçbir şey yapmıyor; eskiden sesteki
    // kişiyi sesten atıyordu (H4).
    if (channelId === activeChannelRef.current) return
    setMessages([])
    setEphemeralPhotos([])
    setTypingUsers([])
    setUnreadChannels((prev) => prev.filter((c) => c !== channelId))
    setHasMoreHistory(true)
    setConnectionError(null)
    setEnlargedTile(null)
    setActiveChannel(channelId)
    activeChannelRef.current = channelId
    socketRef.current?.emit('join-channel', {
      serverId: activeServerIdRef.current,
      channelId,
      token: sessionTokenRef.current,
    })
  }, [])

  // Tek bağlantının olay dinleyicileri. Bağlantı uygulama boyunca açık
  // kalıyor; dinleyiciler burada takılıyor (kullandıkları fonksiyonlar
  // değişirse yeniden takılıyor).
  const hasConnectedBeforeRef = useRef(false)
  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    // Yeniden bağlanınca (internet bir an gidip geldiğinde, sunucu yeniden
    // başladığında) o sırada açık olan kanala giriliyor, sesteysek kanala
    // girer girmez sese de dönülüyor. İlk bağlantıda henüz kanal yok.
    socket.on('connect', () => {
      setConnectionStatus('connected')
      const isReconnect = hasConnectedBeforeRef.current
      hasConnectedBeforeRef.current = true
      if (isReconnect) refreshPresenceRef.current?.()
      const channelId = activeChannelRef.current
      if (!isReconnect || !channelId || !sessionTokenRef.current) return
      socket.emit(
        'join-channel',
        { serverId: activeServerIdRef.current, channelId, token: sessionTokenRef.current },
        (response) => {
          if (response?.success && voiceChannelRef.current) rejoinVoice(socket)
        }
      )
    })

    socket.on('disconnect', () => {
      setConnectionStatus('reconnecting')
    })

    // Kanala girilemedi (ör. sunucudan çıkarıldıktan sonra yeniden
    // bağlanırken): sesi de tamamen kapatıyoruz. Eskiden sadece soket
    // kapanıyor; mikrofon/kamera açık, eş bağlantıları ayakta ve
    // kenar çubuğundaki 🎙️ işareti asılı kalıyordu (H14).
    socket.on('join-error', (message) => {
      setConnectionError(message || 'Kanala katılamadın.')
      // Sunucudan atılınca başka bir sunucuya geçiliyor ve hata alanı
      // temizleniyor; neden çıkarıldığımız bildirim şeridinde kalsın.
      setNotice(message || 'Kanala katılamadın.')
      socket.emit('leave-channel')
      resetVoiceState()
      setActiveChannel(null)
    })

    // Sunucudaki biri çevrimiçi oldu/çıktı ya da sese girdi/çıktı: sağdaki
    // üye listesi yenilensin. (Sunucu eski istemciler için kanal başına
    // 'channel-members' de gönderiyor; liste artık ondan çizilmiyor.)
    socket.on('presence-changed', ({ serverId } = {}) => {
      if (serverId === activeServerIdRef.current) refreshPresenceRef.current?.()
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
      const myName = displayNameRef.current
      const isOwnMessage = message.username === myName
      // YENİ: "@all" da tıpkı kendi adının bahsedilmesi gibi bildirim
      // sesi çalsın — herkese yönelik bir çağrı, sadece belirli bir
      // kişiye değil.
      const isMention =
        (myName && message.text?.toLowerCase().includes(`@${myName.toLowerCase()}`)) ||
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
      if (photo.username !== displayNameRef.current) playMessageSound()
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
    socket.on('channel-activity', ({ channelId: activityChannelId }) => {
      if (activityChannelId === activeChannelRef.current) return
      setUnreadChannels((prev) =>
        prev.includes(activityChannelId) ? prev : [...prev, activityChannelId]
      )
    })

    // ---- Ses (voice) ile ilgili dinleyiciler — 'sese katıl' denene kadar
    // tetiklenmezler ama baştan hazır olmaları lazım. ----
    socket.on('existing-voice-users', (users) => {
      setPeers(users)
    })

    socket.on('voice-user-joined', (user) => {
      setPeers((prev) => [...prev.filter((p) => p.socketId !== user.socketId), user])
      // Yeni bağlantı açık olan mikrofon/kamera/ekranı kendiliğinden taşıyor.
      startMainConnection(user.socketId)
      playJoinSound()
    })

    // Sunucu bizi sesten çıkardı: aynı hesapla başka bir yerden sese
    // girildi ya da bu kanala erişim kalktı.
    socket.on('voice-ended', ({ message } = {}) => {
      resetVoiceState()
      if (message) setNotice(message)
    })

    // Sunucudan atıldık, sunucu silindi ya da rolümüz değişti: sunucu ve
    // kanal listeleri yenilensin.
    socket.on('server-list-changed', () => {
      refreshServerDataRef.current?.()
    })

    // Sunucudaki biri kanal ekledi ya da sunucuya biri katıldı/çıkarıldı:
    // listeler anında yenilensin (H16; eskiden sunucu değiştirip geri
    // gelene kadar görünmüyordu).
    socket.on('channels-changed', ({ serverId } = {}) => {
      if (serverId === activeServerIdRef.current) refreshServerDataRef.current?.()
    })
    socket.on('members-changed', ({ serverId } = {}) => {
      if (serverId === activeServerIdRef.current) refreshServerMembersRef.current?.()
    })

    socket.on('voice-user-left', ({ socketId }) => {
      playLeaveSound()
      setPeers((prev) => prev.filter((p) => p.socketId !== socketId))
      const entry = peerConnectionsRef.current.get(socketId)
      if (entry) {
        if (entry.mainPc) entry.mainPc.close()
        peerConnectionsRef.current.delete(socketId)
      }
      setRemoteStreams((prev) => {
        const updated = { ...prev }
        delete updated[socketId]
        return updated
      })
    })

    socket.on('signal', async ({ from, data }) => {
      // Güncellemeyi almamış istemcilerin ayrı ekran bağlantısı artık yok.
      if (data.connectionType === 'screen') return
      const connectionType = 'main'
      const entry = getPeerEntry(from)

      // Karşı taraf ana bağlantısını bir hata yüzünden kapattı ve yenisini
      // istiyor: başlatan taraf olarak sıfırdan kuruyoruz.
      if (data.type === 'restart-request') {
        entry.mainPc?.close()
        entry.mainPc = null
        startMainConnection(from)
        return
      }

      const pc = entry.mainPc || (data.type === 'offer' ? acceptMainConnection(from) : null)
      // Kapatılmış bir bağlantıya ait geç gelen cevap ya da aday.
      if (!pc) return

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
            debugLog(
              `[signal] ${from}/${connectionType} - çakışan teklif yok sayıldı (impolite taraf)`
            )
            return
          }
          // Not: pc.polite true iken burada setRemoteDescription çağrılması,
          // signalingState "have-local-offer" ise tarayıcı tarafından
          // otomatik olarak rollback yapılmasını sağlar (spec gereği).
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          // Teklifle gelen kanallara kendi izlerimizi tak, cevap da "ikisi
          // de gönderiyor" (sendrecv) olarak gitsin.
          attachLocalMedia(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket.emit('signal', {
            to: from,
            data: { type: 'answer', sdp: pc.localDescription, connectionType },
          })
          syncReceiversToStream(pc, from)
        } else if (data.type === 'answer') {
          pc.isSettingRemoteAnswerPending = true
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          pc.isSettingRemoteAnswerPending = false
          syncReceiversToStream(pc, from)
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
        entry.mainPc = null
        setRemoteStreams((prev) => {
          const updated = { ...prev }
          delete updated[from]
          return updated
        })
        // Bağlantı olmadan ses gelmez: başlatan tarafsak yenisini kuruyoruz,
        // değilsek karşı taraftan istiyoruz. Sonsuz döngüye girmesin diye
        // kişi başı en fazla 3 kez.
        entry.mainRestarts = (entry.mainRestarts || 0) + 1
        if (entry.mainRestarts <= 3) {
          if (pc.isInitiator) startMainConnection(from)
          else socket.emit('signal', { to: from, data: { type: 'restart-request' } })
        }
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

    // YENİ: kilitli bir hesabın girişi (Üye Yönetimi'nden) açılınca.
    socket.on('user-login-unlocked', ({ username: targetUsername }) => {
      setAllUsers((prev) =>
        prev.map((u) => (u.username === targetUsername ? { ...u, isLoginLocked: false } : u))
      )
    })

    // YENİ: bir IP'nin banı kaldırılınca, Güvenlik listesinden de düş.
    socket.on('ip-unbanned', ({ ip }) => {
      setBannedIps((prev) => prev.filter((b) => b.ip !== ip))
    })

    // YENİ: bir IP kalıcı banlandığında (kayıt ekranına saldırı
    // niteliğinde deneme), ŞU AN bağlıysak anlık uyarı al.
    socket.on('security-alert', (alert) => {
      setSecurityAlert(alert)
      setBannedIps((prev) => {
        if (prev.some((b) => b.ip === alert.ip)) return prev
        return [
          { ip: alert.ip, reason: alert.reason, attemptCount: alert.attemptCount, bannedAt: new Date() },
          ...prev,
        ]
      })
    })

    return () => {
      socket.removeAllListeners()
    }
  }, [
    getPeerEntry,
    startMainConnection,
    acceptMainConnection,
    attachLocalMedia,
    syncReceiversToStream,
    resetVoiceState,
    rejoinVoice,
  ])

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
          debugLog('[mikrofon] getUserMedia çağrılıyor...')
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
          })
          const newAudioTrack = micStream.getAudioTracks()[0]
          debugLog(
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
          // Ref'i hemen güncelliyoruz: bu arada kurulan bir bağlantı da
          // (bkz. attachLocalMedia) yeni izi bulsun.
          localMainStreamRef.current = newLocalStream
          setLocalMainStream(newLocalStream)
          setIsMicOn(true)
          setLocalTrackOnMainConnections('mic', newAudioTrack)
          debugLog(
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
    [localMainStream, setLocalTrackOnMainConnections, selectedAudioInput]
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
      setLocalTrackOnMainConnections('camera', null)
      existingVideoTrack.stop()
      const remaining = localMainStream.getTracks().filter((t) => t !== existingVideoTrack)
      const newLocalStream = remaining.length > 0 ? new MediaStream(remaining) : null
      localMainStreamRef.current = newLocalStream
      setLocalMainStream(newLocalStream)
      setIsCameraOn(false)
      socketRef.current?.emit('state-update', { cameraOn: false })
      return
    }
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true })
      const newVideoTrack = camStream.getVideoTracks()[0]
      const otherTracks = localMainStream ? localMainStream.getTracks() : []
      const newLocalStream = new MediaStream([...otherTracks, newVideoTrack])
      localMainStreamRef.current = newLocalStream
      setLocalMainStream(newLocalStream)
      setIsCameraOn(true)
      setLocalTrackOnMainConnections('camera', newVideoTrack)
      socketRef.current?.emit('state-update', { cameraOn: true })
    } catch (err) {
      setMediaError(describeMediaError(err))
    }
  }, [localMainStream, isCameraOn, setLocalTrackOnMainConnections])

  const stopScreenShare = useCallback(() => {
    const screenStream = localScreenStreamRef.current
    setLocalTrackOnMainConnections('screen', null)
    setLocalTrackOnMainConnections('screenAudio', null)
    // Sistem sesi izi de duruyor; eskiden sadece görüntü durduruluyordu.
    screenStream?.getTracks().forEach((track) => track.stop())
    localScreenStreamRef.current = null
    setLocalScreenStream(null)
    setIsScreenSharing(false)
    socketRef.current?.emit('state-update', { sharingScreen: false })
  }, [setLocalTrackOnMainConnections])

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
      // Ref'i hemen güncelliyoruz: bu andan sonra sese giren biri de
      // paylaşımı alsın (yeni bağlantılar izleri bu ref'ten alıyor).
      localScreenStreamRef.current = screenStream
      setLocalScreenStream(screenStream)
      setIsScreenSharing(true)
      setLocalTrackOnMainConnections('screen', screenTrack)
      // Sistem sesi yakalanabildiyse (her zaman garanti değil, kaynağa
      // göre değişebilir), onu da ayrıca gönderiyoruz.
      const screenAudioTrack = screenStream.getAudioTracks()[0]
      // YENİ (teşhis): sistem sesi hiç YAKALANAMADIYSA (Windows'ta loopback
      // her zaman garanti değil), bunu en baştan burada görmemiz lazım —
      // yoksa "ses gitmiyor" şikayeti gelince nereden başlayacağımızı
      // bilemiyoruz (yakalama mı, iletim mi, çalma mı?).
      debugLog(
        '[ekran sesi] sistem sesi track’i:',
        screenAudioTrack
          ? `VAR — enabled:${screenAudioTrack.enabled}, readyState:${screenAudioTrack.readyState}, muted:${screenAudioTrack.muted}, label:${screenAudioTrack.label}`
          : 'YOK (bu ekran/pencere kaynağından sistem sesi yakalanamadı)'
      )
      if (screenAudioTrack) setLocalTrackOnMainConnections('screenAudio', screenAudioTrack)
      socketRef.current?.emit('state-update', { sharingScreen: true })
      playScreenShareSound()
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setMediaError(describeMediaError(err))
      }
    }
  }, [setLocalTrackOnMainConnections, stopScreenShare])

  const toggleScreenShare = useCallback(() => {
    if (isScreenSharing) stopScreenShare()
    else startScreenShare()
  }, [isScreenSharing, startScreenShare, stopScreenShare])

  // YENİ: hem normal giriş hem de "beni hatırla" ile otomatik oturum
  // devamında (resume-session) AYNI başarı yanıtını uygulamamız
  // gerekiyor — tekrar tekrar yazmamak için ortak fonksiyon.
  const applyLoginResponse = useCallback((response) => {
    setUsername(response.username)
    setSessionToken(response.token)
    // Bağlantı yeniden kurulursa el sıkışmada hemen bu anahtar gitsin.
    sessionTokenRef.current = response.token
    if (Array.isArray(response.iceServers) && response.iceServers.length > 0) {
      setIceServers(response.iceServers)
    }
    debugLog('[ICE sunucuları] sunucudan gelenler:', response.iceServers)
    // YENİ: artık tek bir kanal listesi değil, erişilen SUNUCULARIN
    // listesi geliyor — hangi sunucunun kanallarının gösterileceğine
    // aşağıdaki myServers izleyen useEffect karar veriyor.
    setMyServers(Array.isArray(response.myServers) ? response.myServers : [])
    setMyAvatar(response.avatarData || null)
    debugLog('[giriş] sunucudan gelen roller:', response.roles)
    setMyRoles(Array.isArray(response.roles) ? response.roles : [])
    setLoggedIn(true)
  }, [])

  // Cevap bekleyen istekler (giriş, sunucu oluştur/katıl, kanal listesi…)
  // uygulamanın tek bağlantısı üzerinden gidiyor. Bağlantı o an kopuksa
  // istek bekliyor ve bağlanınca gidiyor; Render'ın ücretsiz planı uykudan
  // uyanırken bu bir dakikaya yaklaşabildiği için süre uzun.
  const emitRequest = useCallback(async (event, payload) => {
    try {
      return await socketRef.current.timeout(60_000).emitWithAck(event, payload)
    } catch {
      return { success: false, message: 'Sunucuya bağlanılamadı.' }
    }
  }, [])

  const fetchServerChannels = useCallback(
    async (serverId) => {
      const response = await emitRequest('server-channels', {
        token: sessionTokenRef.current,
        serverId,
      })
      setChannels(response?.success ? response.channels || [] : [])
    },
    [emitRequest]
  )

  // Sağdaki üye listesi: aktif sunucunun üyelerinden kim çevrimiçi (herhangi
  // bir yerden bağlı), kim çevrimdışı, kim hangi kanalın sesinde. Eskiden
  // sadece o kanalı o an açık tutanlar "çevrimiçi" sayılıyordu.
  const fetchServerPresence = useCallback(
    async (serverId) => {
      const response = await emitRequest('server-presence', {
        token: sessionTokenRef.current,
        serverId,
      })
      if (!response?.success || serverId !== activeServerIdRef.current) return
      const byName = (a, b) => a.username.localeCompare(b.username, 'tr')
      const members = response.members.map((m) => ({ ...m, inVoice: !!m.voiceChannelId }))
      setOnlineMembers(members.filter((m) => m.online).sort(byName))
      setOfflineMembers(members.filter((m) => !m.online).sort(byName))
    },
    [emitRequest]
  )

  // Aktif sunucu değişince ve giriş yapılınca listeyi getir; art arda gelen
  // değişiklik duyurularını (presence-changed) tek istekte topla.
  useEffect(() => {
    if (!loggedIn || !activeServerId) return
    fetchServerPresence(activeServerId)
    let timer = null
    refreshPresenceRef.current = () => {
      clearTimeout(timer)
      timer = setTimeout(() => fetchServerPresence(activeServerIdRef.current), 200)
    }
    return () => {
      clearTimeout(timer)
      refreshPresenceRef.current = null
    }
  }, [loggedIn, activeServerId, fetchServerPresence])

  // YENİ: aktif sunucuyu değiştir — mevcut kanaldan/sesten çık (başka bir
  // sunucunun sesine/kanalına "sızmasın"), yeni sunucunun kanal listesini
  // getir.
  const selectServer = useCallback(
    (serverId) => {
      setActiveServerId(serverId)
      window.localStorage?.setItem('activeServerId', serverId)
      leaveChannel()
      setChannels([])
      fetchServerChannels(serverId)
      setMobileSidebarOpen(false)
    },
    [leaveChannel, fetchServerChannels]
  )

  const refreshMyServers = useCallback(async () => {
    const response = await emitRequest('list-my-servers', {
      token: sessionTokenRef.current,
    })
    if (response?.success) setMyServers(response.servers || [])
    return response
  }, [emitRequest])

  useEffect(() => {
    refreshServerDataRef.current = () => {
      refreshMyServers()
      if (activeServerIdRef.current) fetchServerChannels(activeServerIdRef.current)
    }
  }, [refreshMyServers, fetchServerChannels])

  const handleCreateServer = useCallback(async () => {
    if (!newServerName.trim()) return
    setServerModalBusy(true)
    setServerModalError(null)
    const response = await emitRequest('create-server', {
      token: sessionTokenRef.current,
      name: newServerName.trim(),
    })
    setServerModalBusy(false)
    if (response?.success) {
      setNewServerName('')
      setShowServerModal(false)
      await refreshMyServers()
      selectServer(response.server.id)
    } else {
      setServerModalError(response?.message || 'Sunucu oluşturulamadı.')
    }
  }, [newServerName, emitRequest, refreshMyServers, selectServer])

  const handleJoinServer = useCallback(async () => {
    if (!joinInviteCode.trim()) return
    setServerModalBusy(true)
    setServerModalError(null)
    const response = await emitRequest('join-server-by-invite', {
      token: sessionTokenRef.current,
      inviteCode: joinInviteCode.trim(),
    })
    setServerModalBusy(false)
    if (response?.success) {
      setJoinInviteCode('')
      setShowServerModal(false)
      await refreshMyServers()
      selectServer(response.server.id)
    } else {
      setServerModalError(response?.message || 'Sunucuya katılamadın.')
    }
  }, [joinInviteCode, emitRequest, refreshMyServers, selectServer])

  // YENİ: sunucuyu tamamen sil — sadece sahibi/platform admini
  // çağırabiliyor (arayüzden de sadece onlara gösteriliyor).
  const handleDeleteServer = useCallback(async () => {
    if (!activeServerIdRef.current) return
    if (
      !window.confirm(
        'Bu sunucuyu tamamen silmek istediğine emin misin? Tüm kanalları ve mesajları da silinecek.'
      )
    ) {
      return
    }
    const response = await emitRequest('delete-server', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
    })
    if (response?.success) {
      setServerInvitePopover(null)
      leaveChannel()
      setActiveServerId(null)
      window.localStorage?.removeItem('activeServerId')
      await refreshMyServers()
    }
  }, [emitRequest, leaveChannel, refreshMyServers])

  const openServerInvitePopover = useCallback(async () => {
    const response = await emitRequest('get-server-invite', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
    })
    if (response?.success) setServerInvitePopover({ code: response.inviteCode })
  }, [emitRequest])

  // YENİ: sunucu sahibi kanal eklesin diye — v1'de basit bir prompt()
  // yeterli, kanalın kendine has bir ayar ekranı yok henüz.
  const handleCreateChannel = useCallback(async () => {
    const name = window.prompt('Yeni kanalın adı:')
    if (!name || !name.trim()) return
    const response = await emitRequest('create-channel', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
      name: name.trim(),
    })
    if (response?.success) {
      fetchServerChannels(activeServerIdRef.current)
    } else {
      window.alert(response?.message || 'Kanal oluşturulamadı.')
    }
  }, [emitRequest, fetchServerChannels])

  const fetchServerMembers = useCallback(async () => {
    if (!activeServerIdRef.current) return
    const response = await emitRequest('list-server-members', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
    })
    if (response?.success) setServerMembers(response.members || [])
  }, [emitRequest])

  const removeServerMember = useCallback(
    async (targetUsername) => {
      const response = await emitRequest('remove-server-member', {
        token: sessionTokenRef.current,
        serverId: activeServerIdRef.current,
        targetUsername,
      })
      if (response?.success) fetchServerMembers()
    },
    [emitRequest, fetchServerMembers]
  )

  // YENİ: erişilebilen sunucular geldiğinde (girişte / oturum devamında),
  // son kalınan sunucuya (localStorage'da saklı) ya da yoksa ilkine
  // otomatik geç — kullanıcı her açılışta yeniden seçmek zorunda kalmasın.
  useEffect(() => {
    if (myServers.length === 0) return
    const stored = activeServerIdRef.current
    if (stored && myServers.some((s) => s.id === stored)) {
      fetchServerChannels(stored)
      return
    }
    selectServer(myServers[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myServers])

  // YENİ: uygulama açılışında, "beni hatırla" ile kaydedilmiş bir
  // belirteç varsa şifre sormadan otomatik giriş yapmayı dene; başarılı
  // olursa normal giriş akışıyla AYNI şekilde devam ediyoruz.
  useEffect(() => {
    const storedToken = window.localStorage?.getItem('rememberedSessionToken')
    if (!storedToken) return

    emitRequest('resume-session', { token: storedToken }).then((response) => {
      setIsRestoringSession(false)
      if (response?.success) {
        setRememberMe(true)
        applyLoginResponse(response)
      } else if (response?.message !== 'Sunucuya bağlanılamadı.') {
        // Belirteç artık geçersiz (süresi dolmuş, ya da çıkış yapılmış) —
        // bir daha denemeyelim diye temizliyoruz. Sunucuya hiç
        // ulaşılamadıysa silmiyoruz, bir dahaki açılışta tekrar denenir.
        window.localStorage?.removeItem('rememberedSessionToken')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // YENİ: Çıkış yap — hesaptan tamamen çıkar (kanaldan ayrılmaktan
  // FARKLI), "beni hatırla" kaydını da temizler ki bir dahaki açılışta
  // otomatik girmesin.
  const handleLogout = () => {
    // Çıkış, kanalda olup olmamaktan bağımsız olarak her zaman sunucuya
    // gidiyor (eskiden sadece açık bir kanal bağlantısı varsa gidiyordu,
    // H18). Sunucu oturumu siliyor ve bağlantıyı bizden ayırıyor; bağlantı
    // açık kalıyor, yeniden bağlanırken de artık anahtar gönderilmiyor.
    leaveChannel()
    emitRequest('logout', { token: sessionTokenRef.current })
    sessionTokenRef.current = null
    window.localStorage?.removeItem('rememberedSessionToken')
    setLoggedIn(false)
    setUsername('')
    setPassword('')
    setSessionToken(null)
    setChannels([])
    setMyServers([])
    setMyAvatar(null)
    setMyRoles([])
    setRememberMe(false)
    setShowAppSettings(false)
  }

  const handleLogin = (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setIsLoggingIn(true)
    setLoginError(null)

    emitRequest('login', { username: username.trim(), password, rememberMe }).then((response) => {
      setIsLoggingIn(false)
      if (response?.success) {
        // YENİ: "beni hatırla" işaretliyse, belirteci kalıcı olarak
        // sakla — bir dahaki açılışta şifre sormadan otomatik girer.
        if (rememberMe) {
          window.localStorage?.setItem('rememberedSessionToken', response.token)
        }
        applyLoginResponse(response)
      } else {
        setLoginError(response?.message || 'Giriş başarısız.')
      }
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

    emitRequest('register', {
      username: username.trim(),
      password,
      inviteCode: inviteCode.trim(),
    }).then((response) => {
      setIsRegistering(false)
      if (response?.success) {
        setAuthMode('login')
        setPassword('')
        setInviteCode('')
        setRegisterSuccessMessage('Kayıt başarılı! Şimdi giriş yapabilirsin.')
      } else {
        setRegisterError(response?.message || 'Kayıt başarısız.')
      }
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
  // DÜZELTME: sadece çevrimiçi üyeler öneriliyordu — çevrimdışı birinin
  // (ör. "!sil @kullanıcı" ile moderasyon yapmak istediğin, artık bağlı
  // olmayan biri) tam kullanıcı adını bilmeden etiketlemek/hedeflemek
  // imkânsız hâle geliyordu. Artık çevrimdışı üyeler de öneriliyor
  // (ayırt edilebilsin diye etiketinde belirtiliyor).
  const mentionCandidates =
    mentionQuery === null
      ? []
      : [
          { username: 'all', label: '@all — herkese' },
          ...onlineMembers
            .filter((m) => m.username !== displayName)
            .map((m) => ({ username: m.username, label: `@${m.username}` })),
          ...offlineMembers.map((m) => ({
            username: m.username,
            label: `@${m.username} (çevrimdışı)`,
          })),
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

  // Fotoğraflar Socket.IO yerine HTTP ile gidiyor (sunucuda /api/photos):
  // böylece sunucu bütün olaylar için 15 MB'lık paketlere izin vermek
  // zorunda kalmıyor. Hatalar bilgi şeridinde gösteriliyor (eskiden sadece
  // sesteyken görünen alana yazılıyordu).
  const sendPhotoFile = (file) => {
    const channelId = activeChannelRef.current
    if (!file || !channelId) return

    if (!file.type.startsWith('image/')) {
      setNotice('Sadece görsel dosyaları paylaşılabilir.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setNotice('Fotoğraf çok büyük (en fazla 10 MB olabilir).')
      return
    }

    setIsSendingPhoto(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/photos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionTokenRef.current}`,
          },
          body: JSON.stringify({ channelId, imageData: reader.result, mimeType: file.type }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          setNotice(body.message || 'Fotoğraf gönderilemedi.')
        }
      } catch {
        setNotice('Fotoğraf gönderilemedi, bağlantını kontrol et.')
      } finally {
        setIsSendingPhoto(false)
      }
    }
    reader.onerror = () => {
      setNotice('Fotoğraf okunamadı, tekrar dener misin?')
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

  // YENİ: aktif sunucunun sahibiyse, Ayarlar açıkken "Sunucu Üyeleri"
  // listesini getir — platform-geneli "Üye Yönetimi"nden AYRI, sadece
  // BU sunucuya özel bir üye/kick listesi.
  useEffect(() => {
    const isOwnerOfActiveServer = myServers.find((s) => s.id === activeServerId)?.isOwner
    const showsServerMembers = showAppSettings && isOwnerOfActiveServer
    if (showsServerMembers) fetchServerMembers()
    // Sunucuya biri katılınca/çıkarılınca liste açıksa yenilensin (H16).
    refreshServerMembersRef.current = showsServerMembers ? fetchServerMembers : null
  }, [showAppSettings, myServers, activeServerId, fetchServerMembers])

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

  // YENİ: kilitli bir hesabın girişini erken açma (5 yanlış şifreden
  // sonraki otomatik kilit için).
  const unlockUserLogin = (targetUsername) => {
    socketRef.current?.emit('unlock-user-login', {
      token: sessionTokenRef.current,
      targetUsername,
    })
  }

  // YENİ: Güvenlik — banlı IP listesini çekme + banı kaldırma.
  const fetchBannedIps = useCallback(() => {
    if (!socketRef.current) return
    setIsLoadingBannedIps(true)
    socketRef.current.emit('list-banned-ips', { token: sessionTokenRef.current }, (response) => {
      setIsLoadingBannedIps(false)
      if (response?.success) setBannedIps(response.bannedIps || [])
    })
  }, [])

  useEffect(() => {
    if (showAppSettings && isAdmin) fetchBannedIps()
  }, [showAppSettings, isAdmin, fetchBannedIps])

  const unbanIp = (ip) => {
    socketRef.current?.emit('unban-ip', { token: sessionTokenRef.current, ip })
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
  // Menü normalde mesajın üstünde açılıyor; mesaj sohbetin en üstündeyse
  // orada yer olmadığı için kesiliyor ve düğmelerine tıklanamıyordu, o
  // durumda altında açılıyor.
  const [reactionPickerBelow, setReactionPickerBelow] = useState(false)
  const handleMessageContextMenu = (e, messageId) => {
    e.preventDefault()
    const messageTop = e.currentTarget.getBoundingClientRect().top
    const chatTop = chatMessagesRef.current?.getBoundingClientRect().top ?? 0
    setReactionPickerBelow(messageTop - chatTop < 48)
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

  // YENİ: "beni hatırla" ile kaydedilmiş bir oturum varsa, onu deneme
  // sonuçlanana kadar giriş formunu HİÇ göstermiyoruz — yoksa her
  // açılışta bir anlığına giriş ekranı "çakıp" sonra otomatik
  // giriş yapılmış gibi görünürdü, rahatsız edici bir titreşim olurdu.
  if (isRestoringSession) {
    return (
      <div className="name-entry">
        <img src={logoUrl} alt="Disco" className="app-logo app-logo--login" />
        <h1>Disco</h1>
        <p>Oturum açılıyor…</p>
      </div>
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
              <label className="remember-me-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Beni hatırla
              </label>
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

  // YENİ: activeChannel/voiceChannel artık isim değil, kanalın ObjectId'si —
  // görüntülemek için ada bakıyoruz. activeServer* de aktif sunucunun
  // görüntü adı/sahiplik durumu için.
  const activeChannelName = channels.find((c) => c.id === activeChannel)?.name || ''
  const voiceChannelName = channels.find((c) => c.id === voiceChannel)?.name || ''
  const activeServer = myServers.find((s) => s.id === activeServerId)
  const activeServerName = activeServer?.name || ''
  const activeServerIsOwner = !!activeServer?.isOwner
  // Başkasının mesajını silebilir mi: platform yöneticisi ya da bu sunucunun
  // sahibi. Sunucu sahibine zaten izin veriyordu ama arayüz düğmeyi sadece
  // platform yöneticisine gösteriyordu (H17).
  const canModerateActiveServer = isAdmin || activeServerIsOwner

  return (
    <div className="app-shell">
      {/* YENİ: mobilde soldaki kanal çekmecesini açan sabit konumlu
          düğme — dikey/yatay ekran fark etmeden her zaman erişilebilir
          (kanal seçili olmasa bile görünür, "no-channel" ekranında da). */}
      <button
        type="button"
        className="mobile-sidebar-toggle"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Kanalları göster"
      >
        ☰
      </button>

      {/* YENİ: çekmecelerden biri açıkken arkaya karartma — üzerine
          dokununca ikisini de kapatıyor. */}
      {(mobileSidebarOpen || mobileMembersOpen) && (
        <div
          className="mobile-backdrop"
          onClick={() => {
            setMobileSidebarOpen(false)
            setMobileMembersOpen(false)
          }}
        />
      )}

      {/* YENİ: sunucu şeridi — Discord'daki gibi, her sunucu bir ikon.
          Kanal listesinden AYRI: burası hangi sunucudayım, kanal listesi o
          sunucunun kanalları. */}
      <nav className="server-rail">
        {myServers.map((server) => (
          <button
            key={server.id}
            type="button"
            className={
              'server-rail-icon' + (activeServerId === server.id ? ' server-rail-icon--active' : '')
            }
            title={server.name}
            onClick={() => selectServer(server.id)}
          >
            {server.name.charAt(0).toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className="server-rail-icon server-rail-icon--add"
          title="Sunucu oluştur / katıl"
          onClick={() => {
            setServerModalTab(myServers.some((s) => s.isOwner) ? 'join' : 'create')
            setShowServerModal(true)
          }}
        >
          +
        </button>
      </nav>

      <aside className={'channel-sidebar' + (mobileSidebarOpen ? ' channel-sidebar--open' : '')}>
        <div className="sidebar-brand">
          <img src={logoUrl} alt="Disco" className="app-logo app-logo--sidebar" />
          <h1 className="app-title">{activeServerName || 'Disco'}</h1>
          {activeServerIsOwner && (
            <button
              type="button"
              className="server-invite-button"
              title="Davet kodunu göster"
              onClick={openServerInvitePopover}
            >
              🔗
            </button>
          )}
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>
        <p className="whoami">{displayName} olarak bağlısın</p>
        <nav className="channel-list">
          {channels.map((channel) => {
            const hasUnread = unreadChannels.includes(channel.id)
            const isVoiceHere = voiceChannel === channel.id
            return (
              <button
                key={channel.id}
                className={
                  'channel-button' +
                  (activeChannel === channel.id ? ' channel-button--active' : '')
                }
                onClick={() => {
                  joinChannel(channel.id)
                  setMobileSidebarOpen(false)
                }}
              >
                # {channel.name}
                {/* YENİ: sesin hangi kanalda olduğunu, o kanalı görüntülemesen
                    bile listede görebilesin diye. */}
                {isVoiceHere && <span className="channel-voice-indicator">🎙️</span>}
                {hasUnread && <span className="channel-unread-dot" />}
              </button>
            )
          })}
          {/* YENİ: aktif sunucunun sahibiyse (ya da platform adminse), yeni
              kanal ekleyebilme düğmesi — çoklu sunucuda kanal artık env
              yerine veritabanından, sahibi ekleyebiliyor. */}
          {activeServerIsOwner && (
            <button
              type="button"
              className="channel-button channel-button--add"
              onClick={handleCreateChannel}
            >
              + Kanal ekle
            </button>
          )}
        </nav>

        {/* YENİ: Discord tarzı güncelleme bildirimi — indirilirken küçük
            bir ilerleme yazısı, indirme bitince tıklanabilir "yeniden
            başlat" düğmesi. Güncelleme yoksa hiçbir şey görünmüyor. */}
        {updateReady ? (
          <button
            type="button"
            className="update-ready-button"
            onClick={() => window.electronAPI?.installUpdate()}
            title={updateInfo?.version ? `Sürüm ${updateInfo.version}` : undefined}
          >
            🆕 Güncelleme hazır — Yeniden başlat
          </button>
        ) : (
          updateInfo &&
          updateProgress !== null && (
            <p className="update-progress-text">Güncelleme iniyor… %{updateProgress}</p>
          )
        )}

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
        {notice && notice !== connectionError && (
          <div className="notice-banner" role="status">
            {notice}
          </div>
        )}
        {connectionError && (
          <div className="no-channel-placeholder">
            <p className="error-text">{connectionError}</p>
          </div>
        )}

        {!activeChannel && !connectionError && myServers.length === 0 && (
          <div className="no-channel-placeholder">
            <p>Henüz bir sunucun yok — sağdaki "+" ile kendi sunucunu oluştur ya da bir davet koduyla katıl.</p>
          </div>
        )}

        {!activeChannel && !connectionError && myServers.length > 0 && (
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
                <h2># {activeChannelName}</h2>
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
                  {/* YENİ: mobilde sağdaki üye listesini açan düğme —
                      liste artık kaydırmalı bir çekmece. */}
                  <button
                    type="button"
                    className="mobile-members-toggle"
                    onClick={() => setMobileMembersOpen(true)}
                    aria-label="Üyeleri göster"
                  >
                    👥
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
                    🎙️ Sesli sohbettesin: <strong># {voiceChannelName}</strong>
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
                          onClick={() => setPhotoLightbox(item.imageData)}
                        />
                        <span className="chat-photo-hint">📷 tek seferlik — kaydedilmiyor</span>
                      </div>
                    ) : (
                      <div
                        key={item.id || `text-${i}`}
                        className={
                          'chat-message chat-message--text-wrap' +
                          (item.system ? ' chat-message--system' : '')
                        }
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
                              <div
                                className={
                                  'reaction-picker reaction-picker--open' +
                                  (reactionPickerBelow ? ' reaction-picker--below' : '')
                                }
                              >
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
                              {/* Silme kendi mesajınla sınırlı değil: platform
                                  yöneticisi ve sunucunun sahibi BAŞKASININ mesajını
                                  da tek tıkla silebiliyor (moderasyon). Düzenleme
                                  hâlâ sadece kendi mesajın için. */}
                              {(item.username === displayName || canModerateActiveServer) && (
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
                              {(item.username === displayName || canModerateActiveServer) && (
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
            <aside
              className={
                'member-list-panel' + (mobileMembersOpen ? ' member-list-panel--open' : '')
              }
            >
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setMobileMembersOpen(false)}
                aria-label="Kapat"
              >
                ✕
              </button>
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
                      {m.username}{' '}
                      {m.inVoice && (
                        <span
                          title={`Seste: #${channels.find((c) => c.id === m.voiceChannelId)?.name ?? '…'}`}
                        >
                          🎙️
                        </span>
                      )}
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

      {/* YENİ: genel/kalıcı ayarlar penceresi — şimdilik sadece
          kişiselleştirme (renk teması), ileride büyüyecek bir yer. */}
      {photoLightbox && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-label="Fotoğraf"
          onClick={() => setPhotoLightbox(null)}
        >
          <img src={photoLightbox} alt="Paylaşılan fotoğraf" />
        </div>
      )}

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
              <p className="app-settings-hint">{displayName} olarak bağlısın.</p>
              <button type="button" className="device-settings-test-button" onClick={handleLogout}>
                🚪 Çıkış Yap
              </button>
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
              {IS_DESKTOP_APP && (
                <>
                  <p className="app-settings-hint">Yakınlaştırma (Ctrl + ve Ctrl − ile de olur):</p>
                  <ZoomControl
                    zoomLevel={zoomLevel}
                    onZoomOut={zoomOut}
                    onZoomIn={zoomIn}
                    onReset={zoomReset}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                  />
                </>
              )}
            </section>

            {/* YENİ: aktif sunucunun sahibiyse (platform-geneli "Üye
                Yönetimi"nden AYRI) sadece BU sunucunun üyelerini gösterip
                çıkarabilme (kick) imkânı. */}
            {activeServerIsOwner && (
              <section className="app-settings-section">
                <h4>Sunucu Üyeleri — {activeServerName}</h4>
                <p className="app-settings-hint">
                  Bu sunucudaki üyeler. Sunucu sahibi çıkarılamaz.
                </p>
                <div className="user-management-list">
                  {serverMembers.map((m) => (
                    <div key={m.username} className="user-management-row">
                      <span>
                        {m.username}
                        {m.isOwner && ' 👑'}
                      </span>
                      {!m.isOwner && (
                        <button
                          type="button"
                          className="device-settings-test-button"
                          onClick={() => removeServerMember(m.username)}
                        >
                          Çıkar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="device-settings-test-button"
                  onClick={handleDeleteServer}
                >
                  🗑️ Sunucuyu Sil
                </button>
              </section>
            )}

            {/* YENİ: Discord tarzı otomatik güncelleme durumu + manuel
                kontrol düğmesi. Kenar çubuğundaki bildirim otomatik
                çıkıyor zaten — bu sadece "şu an hangi sürümdeyim, elle
                kontrol edeyim" için. */}
            <section className="app-settings-section">
              <h4>Güncelleme</h4>
              <p className="app-settings-hint">
                Şu anki sürüm: {appVersion || '…'}
                {updateReady && updateInfo?.version && ` — ${updateInfo.version} hazır`}
              </p>
              {updateReady ? (
                <button
                  type="button"
                  className="device-settings-test-button"
                  onClick={() => window.electronAPI?.installUpdate()}
                >
                  🆕 Yeniden başlat ve güncelle
                </button>
              ) : (
                <button
                  type="button"
                  className="device-settings-test-button"
                  onClick={() => {
                    setUpdateCheckMessage('Kontrol ediliyor…')
                    window.electronAPI?.checkForUpdates()
                  }}
                >
                  🔄 Güncellemeleri kontrol et
                </button>
              )}
              {updateCheckMessage && <p className="app-settings-hint">{updateCheckMessage}</p>}
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
                      <span className="user-management-name">
                        {u.username}
                        {/* YENİ: 5 yanlış şifreden sonra otomatik kilitlenen
                            hesapları burada görüp erken açabilesin diye. */}
                        {u.isLoginLocked && (
                          <button
                            type="button"
                            className="lock-badge"
                            onClick={() => unlockUserLogin(u.username)}
                            title="Hesap kilitli (çok fazla yanlış şifre) — açmak için tıkla"
                          >
                            🔒 Kilidi aç
                          </button>
                        )}
                      </span>
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

            {/* YENİ: kayıt ekranına saldırı niteliğinde deneme yapıp
                kalıcı banlanan IP'ler burada — yanlışlıkla banlanan biri
                (ör. bir arkadaş) varsa buradan banı kaldırabilirsin. */}
            {isAdmin && (
              <section className="app-settings-section">
                <h4>Güvenlik</h4>
                <p className="app-settings-hint">
                  Kayıt ekranında çok fazla yanlış davet kodu deneyen, kalıcı banlanmış IP'ler.
                </p>
                {isLoadingBannedIps && <p className="app-settings-hint">Yükleniyor…</p>}
                {bannedIps.length === 0 && !isLoadingBannedIps && (
                  <p className="app-settings-hint">Banlı IP yok.</p>
                )}
                <div className="user-management-list">
                  {bannedIps.map((b) => (
                    <div key={b.ip} className="user-management-row">
                      <span className="user-management-name">{b.ip}</span>
                      <p className="app-settings-hint">
                        {b.reason} — {b.attemptCount} deneme
                      </p>
                      <button
                        type="button"
                        className="device-settings-test-button"
                        onClick={() => unbanIp(b.ip)}
                      >
                        Banı kaldır
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* YENİ: sunucu oluştur/katıl modalı — sunucu şeridindeki "+" ile
          açılıyor. */}
      {showServerModal && (
        <div className="app-settings-backdrop" onClick={() => setShowServerModal(false)}>
          <div className="app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-settings-modal-header">
              <h3>Sunucu Oluştur / Katıl</h3>
              <button className="app-settings-close" onClick={() => setShowServerModal(false)}>
                ✕
              </button>
            </div>
            <div className="server-modal-tabs">
              <button
                type="button"
                className={
                  'server-modal-tab' + (serverModalTab === 'create' ? ' server-modal-tab--active' : '')
                }
                onClick={() => {
                  setServerModalTab('create')
                  setServerModalError(null)
                }}
              >
                Oluştur
              </button>
              <button
                type="button"
                className={
                  'server-modal-tab' + (serverModalTab === 'join' ? ' server-modal-tab--active' : '')
                }
                onClick={() => {
                  setServerModalTab('join')
                  setServerModalError(null)
                }}
              >
                Katıl
              </button>
            </div>
            {serverModalTab === 'create' ? (
              <section className="app-settings-section">
                {myServers.some((s) => s.isOwner) ? (
                  <p className="app-settings-hint">
                    Zaten bir sunucun var — kişi başı yalnızca 1 sunucu açılabilir.
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      className="app-settings-input"
                      value={newServerName}
                      onChange={(e) => setNewServerName(e.target.value)}
                      placeholder="Sunucu adı"
                      maxLength={50}
                    />
                    <button
                      type="button"
                      className="device-settings-test-button"
                      onClick={handleCreateServer}
                      disabled={serverModalBusy}
                    >
                      Sunucu Oluştur
                    </button>
                  </>
                )}
              </section>
            ) : (
              <section className="app-settings-section">
                <input
                  type="text"
                  className="app-settings-input"
                  value={joinInviteCode}
                  onChange={(e) => setJoinInviteCode(e.target.value)}
                  placeholder="Davet kodu"
                />
                <button
                  type="button"
                  className="device-settings-test-button"
                  onClick={handleJoinServer}
                  disabled={serverModalBusy}
                >
                  Sunucuya Katıl
                </button>
              </section>
            )}
            {serverModalError && <p className="device-settings-error">{serverModalError}</p>}
          </div>
        </div>
      )}

      {/* YENİ: sunucu davet kodu popover'ı — sadece sahibiyken (🔗
          düğmesiyle) açılabiliyor. */}
      {serverInvitePopover && (
        <div className="app-settings-backdrop" onClick={() => setServerInvitePopover(null)}>
          <div className="app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-settings-modal-header">
              <h3>Sunucu Daveti</h3>
              <button
                className="app-settings-close"
                onClick={() => setServerInvitePopover(null)}
              >
                ✕
              </button>
            </div>
            <section className="app-settings-section">
              <p className="app-settings-hint">
                Bu kodu paylaş — hesabı olan biri "Sunucu Oluştur / Katıl" &gt; "Katıl" ile bu
                sunucuya katılabilir.
              </p>
              <input
                type="text"
                className="app-settings-input"
                value={serverInvitePopover.code}
                readOnly
                onClick={(e) => e.target.select()}
              />
              <button
                type="button"
                className="device-settings-test-button"
                onClick={() => navigator.clipboard?.writeText(serverInvitePopover.code)}
              >
                📋 Kopyala
              </button>
            </section>
          </div>
        </div>
      )}

      {/* YENİ: bir IP kalıcı banlandığında (Alganis şu an bağlıysa) çıkan
          anlık uyarı — "kim banlandı" bilgisi net görünsün diye. */}
      {securityAlert && (
        <div className="security-alert-backdrop" onClick={() => setSecurityAlert(null)}>
          <div className="security-alert-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🚨 Güvenlik uyarısı</h3>
            <p>
              <strong>{securityAlert.ip}</strong> adresi kalıcı olarak banlandı.
            </p>
            <p className="app-settings-hint">
              Sebep: {securityAlert.reason} ({securityAlert.attemptCount} deneme)
            </p>
            <p className="app-settings-hint">
              Bu bir arkadaşın yanlışlıkla tetiklediği bir şeyse, Ayarlar &gt; Güvenlik'ten banı
              kaldırabilirsin.
            </p>
            <button
              type="button"
              className="device-settings-test-button"
              onClick={() => setSecurityAlert(null)}
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
