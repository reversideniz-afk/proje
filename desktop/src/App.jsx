import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { io } from 'socket.io-client'
import { AlertTriangle, Compass, Plus, ServerCrash, WifiOff } from 'lucide-react'
import './App.css'
import { AuthScreen, RestoringScreen } from './components/AuthScreen.jsx'
import { ChannelHeader } from './components/ChannelHeader.jsx'
import { ChannelSidebar } from './components/ChannelSidebar.jsx'
import { ChatPanel } from './components/ChatPanel.jsx'
import {
  ConfirmDialog,
  CreateChannelDialog,
  InviteDialog,
  JoinInviteDialog,
  PhotoLightbox,
  ScreenPicker,
  SecurityAlertDialog,
  ServerDialog,
  VolumePopover,
} from './components/Dialogs.jsx'
import { MemberList } from './components/MemberList.jsx'
import { ServerRail } from './components/ServerRail.jsx'
import { SettingsScreen } from './components/SettingsScreen.jsx'
import { VoiceStage } from './components/VoiceStage.jsx'
import { SERVER_URL, DEFAULT_ICE_SERVERS, IS_DESKTOP_APP } from './lib/config.js'
import { DEBUG, debugLog } from './lib/debug.js'
import { describeMediaError, formatKeyCode } from './lib/format.js'
import { mentionsUser } from './lib/mentions.jsx'
import { DEFAULT_VOICE_SETTINGS, createMicProcessor, gateSettings, micConstraints } from './lib/micProcessor.js'
import { ensureNotificationPermission, requestAttention, setAttentionBadge, showNotification } from './lib/notify.js'
import { useSpeakingDetector } from './lib/speaking.js'
import { setEffectsOutputDevice, playMentionSound, playJoinSound, playLeaveSound, playMessageSound, playScreenShareSound } from './lib/sounds.js'
import { MEDIA_ROLES, ROLE_KINDS, transceiverRoles } from './lib/webrtc.js'

const TYPING_HEARTBEAT_MS = 4000
const TYPING_EXPIRY_MS = 6000

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

  // Masaüstü: kapat düğmesi tepsiye küçültsün mü (varsayılan evet), bilgisayar
  // açılınca başlasın mı (null: geliştirme sürümünde bu ayar yok).
  const [closeToTray, setCloseToTray] = useState(() => window.localStorage?.getItem('closeToTray') !== '0')
  useEffect(() => {
    window.localStorage?.setItem('closeToTray', closeToTray ? '1' : '0')
    window.electronAPI?.setCloseToTray?.(closeToTray)
  }, [closeToTray])
  const [openAtLogin, setOpenAtLogin] = useState(null)
  useEffect(() => {
    window.electronAPI?.getOpenAtLogin?.().then(setOpenAtLogin)
  }, [])
  const changeOpenAtLogin = async (value) => {
    setOpenAtLogin(await window.electronAPI.setOpenAtLogin(value))
  }
  const [settingsInitialPage, setSettingsInitialPage] = useState('account')
  const openSettings = useCallback((page = 'account') => {
    setSettingsInitialPage(page)
    setShowAppSettings(true)
  }, [])

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
  const [serverModalError, setServerModalError] = useState(null)
  const [serverModalBusy, setServerModalBusy] = useState(false)
  // YENİ: sunucu davet kodu popover'ı (sadece sahibiyken açılabiliyor).
  const [serverInvitePopover, setServerInvitePopover] = useState(null) // { code } | null
  // Sahibin oluşturduğu etkin davetler (Ayarlar > Sunucu ayarları).
  const [serverInvites, setServerInvites] = useState([])

  // Davet bağlantısıyla gelindiyse kod: web'de /?davet=KOD (sunucu
  // /davet/KOD'u buraya yönlendiriyor), masaüstünde disco://davet/KOD.
  // Giriş ya da kayıt sürerken sayfa yenilense de kaybolmasın diye oturum
  // deposunda da duruyor.
  const [pendingInvite, setPendingInvite] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('davet')
    if (fromUrl) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      try {
        window.sessionStorage?.setItem('pendingInvite', fromUrl)
      } catch {
        /* sadece bu açılışta geçerli olur */
      }
      return fromUrl
    }
    try {
      return window.sessionStorage?.getItem('pendingInvite') || null
    } catch {
      return null
    }
  })
  const [inviteInfo, setInviteInfo] = useState(null) // invite-info yanıtı
  const [inviteJoin, setInviteJoin] = useState({ busy: false, error: null })
  const clearPendingInvite = useCallback(() => {
    setPendingInvite(null)
    setInviteInfo(null)
    setInviteJoin({ busy: false, error: null })
    try {
      window.sessionStorage?.removeItem('pendingInvite')
    } catch {
      /* yok sayılabilir */
    }
  }, [])
  useEffect(() => {
    if (!window.electronAPI?.onOpenInvite) return
    const open = (code) => code && setPendingInvite(code)
    window.electronAPI.takePendingInvite().then(open)
    // Uygulama açıkken gelen davet ana süreçte de bekliyor: alınca temizle.
    return window.electronAPI.onOpenInvite((code) => {
      open(code)
      window.electronAPI.takePendingInvite()
    })
  }, [])
  // YENİ: "Sunucu Üyeleri" (Ayarlar > sadece aktif sunucunun sahibiyken).
  const [serverMembers, setServerMembers] = useState([])
  // Kanal oluşturma penceresi ve sunucuyu silme onayı. (Kanal adı eskiden
  // window.prompt ile soruluyordu; masaüstü uygulamasında prompt hiç
  // açılmıyor, kanal eklenemiyordu.)
  const [createChannelDialog, setCreateChannelDialog] = useState(null) // { busy, error } | null
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false)

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
  // Masaüstünde üye listesi ve ses ekranındaki sohbet paneli başlıktaki
  // düğmelerle gizlenip açılabiliyor.
  const [membersPanelOpen, setMembersPanelOpen] = useState(true)
  const [voiceChatOpen, setVoiceChatOpen] = useState(true)

  // YENİ: sese girmek artık AYRI, isteğe bağlı bir adım.
  const [inVoice, setInVoice] = useState(false)

  // --- Sohbet ---
  const [messages, setMessages] = useState([])
  // YENİ: fotoğraflar — WhatsApp'ın "tek seferlik" fotoğrafı gibi,
  // HİÇBİR YERE kaydedilmiyor. Bu yüzden mesajlardan (messages) AYRI,
  // sadece bu oturumda tutulan bir liste — kanaldan çıkıp girince,
  // ya da geçmiş mesaj yüklenince buraya hiç dokunulmuyor.
  const [ephemeralPhotos, setEphemeralPhotos] = useState([])
  const [isSendingPhoto, setIsSendingPhoto] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  // YENİ: o an aktif kanalda kimlerin yazıyor olduğu.
  const [typingUsers, setTypingUsers] = useState([])
  const isTypingRef = useRef(false)
  const typingStopTimeoutRef = useRef(null)
  const lastTypingSentAtRef = useRef(0)
  // Karşıdan gelen "yazıyor" kayıtları 6 saniyede kendiliğinden siliniyor;
  // "yazmayı bıraktı" hiç gelmezse (uygulama kapandı, internet gitti)
  // gösterge takılı kalmıyor (H21).
  const typingExpiryRef = useRef(new Map()) // username -> zamanlayıcı
  // YENİ: hangi kanallarda (SADECE üye olunanlarda — sunucu zaten
  // sadece üyelere bildirim gönderiyor) okunmamış aktivite var.
  const [unreadChannels, setUnreadChannels] = useState([])
  // Aktif sunucunun kanallarında kaç kez bahsedildiğin (kanal kimliği -> sayı).
  // İkisi de girişte sunucudan geliyor, uygulama kapalıyken birikenler dahil.
  const [mentionCounts, setMentionCounts] = useState({})
  const unreadChannelsRef = useRef(unreadChannels)
  const mentionCountsRef = useRef(mentionCounts)
  useEffect(() => {
    unreadChannelsRef.current = unreadChannels
    mentionCountsRef.current = mentionCounts
  }, [unreadChannels, mentionCounts])
  // Açık kanalı en son ne zaman okuduğun: "Yeni" çizgisi bunun üstüne çiziliyor.
  const [newMessagesSince, setNewMessagesSince] = useState(null)

  // Bildirim ayarları (bu cihazda kalıcı): masaüstü bildirimi, hangi
  // mesajlarda (sadece bahsedilince ya da hepsi), mesaj sesleri.
  const [notifySettings, setNotifySettings] = useState(() => {
    const defaults = { desktop: true, mode: 'mentions', sounds: true }
    try {
      return { ...defaults, ...JSON.parse(window.localStorage?.getItem('notifySettings') || '{}') }
    } catch {
      return defaults
    }
  })
  const notifySettingsRef = useRef(notifySettings)
  useEffect(() => {
    notifySettingsRef.current = notifySettings
    try {
      window.localStorage?.setItem('notifySettings', JSON.stringify(notifySettings))
    } catch {
      /* kalıcılık olmasa da çalışıyor */
    }
  }, [notifySettings])
  // Başka kanaldan gelen mesaj için bildirim (aşağıda, her çizimde güncel
  // kanal ve sunucu adlarıyla kuruluyor).
  const notifyActivityRef = useRef(null)

  // --- Mikrofon + kamera (ana bağlantı) ---
  const [localMainStream, setLocalMainStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)
  // Seste mikrofonun geçtiği ses kapısı (bkz. lib/micProcessor.js); yerel
  // akıştaki mikrofon izi bunun çıkışı. Kurulamazsa null, ham iz gidiyor.
  const micProcessorRef = useRef(null)
  const [micProcessor, setMicProcessor] = useState(null)

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

  const selectedAudioInputRef = useRef(selectedAudioInput)
  useEffect(() => {
    window.localStorage?.setItem('audioInputId', selectedAudioInput)
    selectedAudioInputRef.current = selectedAudioInput
  }, [selectedAudioInput])

  // Mikrofon ayarları (bu cihazda kalıcı): tarayıcının ses işlemesi ve giriş
  // hassasiyeti (otomatik ya da elle seçilen eşik, dB).
  const [voiceSettings, setVoiceSettings] = useState(() => {
    try {
      return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(window.localStorage?.getItem('voiceSettings') || '{}') }
    } catch {
      return DEFAULT_VOICE_SETTINGS
    }
  })
  const voiceSettingsRef = useRef(voiceSettings)
  useEffect(() => {
    voiceSettingsRef.current = voiceSettings
    try {
      window.localStorage?.setItem('voiceSettings', JSON.stringify(voiceSettings))
    } catch {
      /* kalıcılık olmasa da çalışıyor */
    }
  }, [voiceSettings])

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

  // Bas-konuş (push-to-talk). Tuş, klavyede KeyboardEvent.code (ör. 'KeyV'),
  // farenin yan tuşlarında 'Mouse4' / 'Mouse5'. Seçim bu cihazda kalıcı.
  // Masaüstü uygulamasında pencere arkadayken de çalışıyor (bkz.
  // electron/push-to-talk.cjs), web'de sadece sayfa öndeyken.
  const [pttKey, setPttKey] = useState(() => window.localStorage?.getItem('pttKey') || null)
  const pttEnabled = !!pttKey
  const [isCapturingPttKey, setIsCapturingPttKey] = useState(false)
  useEffect(() => {
    if (pttKey) window.localStorage?.setItem('pttKey', pttKey)
    else window.localStorage?.removeItem('pttKey')
  }, [pttKey])
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
    let x = e.clientX
    let y = e.clientY
    // Klavyeyle açılınca fare konumu yok: düğmenin altında açılsın.
    if (!x && !y) {
      const rect = e.currentTarget.getBoundingClientRect()
      x = rect.left
      y = rect.bottom + 4
    }
    setVolumePopup({ username, x, y })
  }, [])

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
  const analysersRef = useRef(new Map()) // peerSocketId -> AnalyserNode (kim konuşuyor + teşhis)
  const localAnalyserRef = useRef(null) // kendi mikrofonun
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

  // Ses kapısının ayarı (bkz. lib/micProcessor.js): seste ve mikrofon
  // testinde aynı. Bas-konuşta kapı hep açık.
  const gateConfig = useMemo(() => gateSettings(voiceSettings, pttEnabled), [voiceSettings, pttEnabled])
  const gateConfigRef = useRef(gateConfig)

  // Mikrofon testi: seçili mikrofonu ses kapısıyla birlikte kısa süreliğine
  // açıyor; ayarlardaki seviye çubuğu konuşunca doluyor, eşiği geçince
  // yanıyor. Ses hoparlöre verilmiyor (yankı olmasın). 15 saniye sonra ya da
  // tekrar tıklanınca kapanıyor, mikrofon açık unutulmuyor.
  const [micTestProcessor, setMicTestProcessor] = useState(null)
  const isTestingMic = !!micTestProcessor
  const micTestCleanupRef = useRef(null)

  const stopMicTest = useCallback(() => {
    micTestCleanupRef.current?.()
    micTestCleanupRef.current = null
    setMicTestProcessor(null)
  }, [])

  const testMicrophone = useCallback(async () => {
    if (micTestCleanupRef.current) {
      stopMicTest()
      return
    }
    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(selectedAudioInput, voiceSettingsRef.current),
      })
      const ctx = getAudioContext()
      await audioContextReadyRef.current
      const processor = await createMicProcessor(ctx, gateConfigRef.current)
      processor.setInput(stream.getAudioTracks()[0])
      const autoStopTimer = setTimeout(stopMicTest, 15000)
      micTestCleanupRef.current = () => {
        clearTimeout(autoStopTimer)
        processor.dispose()
      }
      setMicTestProcessor(processor)
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop())
      setMediaError(describeMediaError(err))
    }
  }, [selectedAudioInput, getAudioContext, stopMicTest])

  useEffect(() => {
    gateConfigRef.current = gateConfig
    micProcessor?.setGate(gateConfig)
    micTestProcessor?.setGate(gateConfig)
  }, [gateConfig, micProcessor, micTestProcessor])

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

          // Kim konuşuyor göstergesi (ve teşhis kayıtları) için gelen sesi
          // bir AnalyserNode ile de dinliyoruz. Ses seviyesinden önce
          // bağlı: kişinin sesini kısınca ya da sağırlaştırınca da kimin
          // konuştuğu görünüyor. Hoparlöre gitmiyor, sadece ölçüyor.
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 512
          source.connect(analyser)
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

  // Kendi mikrofonunun seviyesi (kutucuğun ve kullanıcı panelindeki
  // avatarın ışıklanması için). Mikrofon kapalıyken (enabled = false) iz
  // sessizlik veriyor, ışık yanmıyor.
  useEffect(() => {
    const track = localMainStream?.getAudioTracks()[0]
    if (!inVoice || !track) return
    const ctx = getAudioContext()
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    localAnalyserRef.current = analyser
    return () => {
      source.disconnect()
      if (localAnalyserRef.current === analyser) localAnalyserRef.current = null
    }
  }, [localMainStream, inVoice, getAudioContext])

  const getSpeakingSources = useCallback(() => {
    const sources = [...analysersRef.current.entries()]
    if (localAnalyserRef.current) sources.push(['local', localAnalyserRef.current])
    return sources
  }, [])
  // Seste kim konuşuyor: karşı tarafların bağlantı kimlikleri ve 'local'.
  const speakingIds = useSpeakingDetector(getSpeakingSources, inVoice)

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
    // Ham mikrofon izi ses kapısında; o da kapanmalı.
    micProcessorRef.current?.dispose()
    micProcessorRef.current = null
    setMicProcessor(null)
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

  // Mikrofon izini alıp yerel akışa ve bağlantılara takıyor. Sese girerken
  // kapalı (enabled = false) olarak çağrılıyor: mikrofonu açmak sadece
  // anahtarı çeviriyor. Eskiden mikrofon ilk açılışta isteniyordu; izin ve
  // cihazın açılması beklenirken (özellikle bas-konuşta) ilk kelimeler
  // kayboluyordu (H28). Bekleyen hazırlık micReadyRef'te.
  const micReadyRef = useRef(null)

  // Ham mikrofon izini ses kapısından geçirip gönderilecek izi döndürüyor.
  // Kapı kurulamazsa (ses motoru çalışmıyor, AudioWorklet yok) ham iz
  // gidiyor: hassasiyet çalışmaz ama mikrofon da susmaz.
  const processMic = useCallback(
    async (rawTrack) => {
      let processor = micProcessorRef.current
      if (!processor) {
        try {
          const ctx = getAudioContext()
          // Kullanıcı etkileşimi olmadan resume() hiç sonuçlanmayabiliyor:
          // en fazla 2 saniye bekleyip ham izle devam ediyoruz.
          const ready = Promise.all([audioContextReadyRef.current, ctx.state === 'running' || ctx.resume()])
          await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 2000))])
          if (ctx.state !== 'running') throw new Error(`ses motoru ${ctx.state}`)
          processor = await createMicProcessor(ctx, gateConfigRef.current)
        } catch (err) {
          console.warn('[mikrofon] ses kapısı kurulamadı, mikrofon işlenmeden gidiyor:', err.message)
          return rawTrack
        }
        // Bu arada sesten çıkıldıysa kapıyı bırak (çağıran ham izi kapatıyor).
        if (!voiceChannelRef.current) {
          processor.dispose()
          return rawTrack
        }
        micProcessorRef.current = processor
        setMicProcessor(processor)
      }
      processor.setInput(rawTrack)
      return processor.track
    },
    [getAudioContext]
  )

  const addMicTrack = useCallback(
    (enabled) => {
      const ready = (async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: micConstraints(selectedAudioInputRef.current, voiceSettingsRef.current),
        })
        const rawTrack = stream.getAudioTracks()[0]
        rawTrack.enabled = enabled
        const track = voiceChannelRef.current ? await processMic(rawTrack) : rawTrack
        // Bu arada sesten çıkıldıysa izi açık bırakma.
        if (!voiceChannelRef.current) {
          rawTrack.stop()
          return null
        }
        track.enabled = enabled
        const otherTracks = localMainStreamRef.current?.getTracks() || []
        const next = new MediaStream([...otherTracks, track])
        // Ref'i hemen güncelliyoruz: bu arada kurulan bir bağlantı da
        // (bkz. attachLocalMedia) yeni izi bulsun.
        localMainStreamRef.current = next
        setLocalMainStream(next)
        setLocalTrackOnMainConnections('mic', track)
        return track
      })()
      micReadyRef.current = ready
      return ready
        .catch((err) => {
          console.error('[mikrofon] getUserMedia hatası:', err.name, err.message)
          setMediaError(describeMediaError(err))
          return null
        })
        .finally(() => {
          if (micReadyRef.current === ready) micReadyRef.current = null
        })
    },
    [setLocalTrackOnMainConnections, processMic]
  )

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
    // Mikrofon yoksa ya da izin verilmezse sese dinleyici olarak giriliyor;
    // mikrofon düğmesi tekrar deniyor.
    addMicTrack(false)
  }, [addMicTrack])

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
    setNewMessagesSince(null)
    setMentionCounts((prev) => {
      if (!prev[channelId]) return prev
      const next = { ...prev }
      delete next[channelId]
      return next
    })
    typingExpiryRef.current.forEach(clearTimeout)
    typingExpiryRef.current.clear()
    setUnreadChannels((prev) => prev.filter((c) => c !== channelId))
    setHasMoreHistory(true)
    setConnectionError(null)
    setEnlargedTile(null)
    setActiveChannel(channelId)
    activeChannelRef.current = channelId
    socketRef.current?.emit(
      'join-channel',
      { serverId: activeServerIdRef.current, channelId, token: sessionTokenRef.current },
      (response) => {
        if (response?.success && channelId === activeChannelRef.current) {
          setNewMessagesSince(response.lastReadAt || null)
        }
      }
    )
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

    // Okumak için yukarı kaydırmış birini yeni mesaj aşağı çekmesin.
    const scrollChatToBottom = (force) => {
      const el = chatMessagesRef.current
      if (!el) return
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
      if (!force && !nearBottom) return
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
    }

    const clearTyping = (username) => {
      clearTimeout(typingExpiryRef.current.get(username))
      typingExpiryRef.current.delete(username)
      setTypingUsers((prev) => prev.filter((u) => u !== username))
    }

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
      const isOwn = message.username === displayNameRef.current
      scrollChatToBottom(isOwn)
      setMessages((prev) => [...prev, message])
      if (message.username) clearTyping(message.username)
      // YENİ: Kendi mesajım değilse ses çal — beni @bahsetmişse (ve
      // pencere görünür değilse) daha belirgin olan bahsetme sesi,
      // aksi halde her mesaj için nazik bir "tık" sesi. İkisi asla
      // aynı anda çalmıyor.
      const myName = displayNameRef.current
      const isOwnMessage = message.username === myName
      // YENİ: "@all" da tıpkı kendi adının bahsedilmesi gibi bildirim
      // sesi çalsın — herkese yönelik bir çağrı, sadece belirli bir
      // kişiye değil.
      const isMention = mentionsUser(message.text, myName) || (!!myName && message.replyTo?.username === myName)
      if (!isOwnMessage && notifySettingsRef.current.sounds) {
        if (isMention && document.hidden) {
          playMentionSound()
        } else {
          playMessageSound()
        }
      }
    })

    // YENİ: fotoğraf geldiğinde — kalıcı 'messages' listesine DEĞİL,
    // ayrı ve geçici 'ephemeralPhotos' listesine ekleniyor.
    socket.on('new-photo', (photo) => {
      const isOwn = photo.username === displayNameRef.current
      scrollChatToBottom(isOwn)
      setEphemeralPhotos((prev) => [...prev, photo])
      if (!isOwn) playMessageSound()
    })

    // YENİ: Yazıyor göstergesi.
    socket.on('user-typing', ({ username }) => {
      clearTimeout(typingExpiryRef.current.get(username))
      typingExpiryRef.current.set(
        username,
        setTimeout(() => clearTyping(username), TYPING_EXPIRY_MS)
      )
      setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]))
    })
    socket.on('user-stopped-typing', ({ username }) => clearTyping(username))

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
    // Erişebildiğin bir kanalda yeni mesaj (sunucu, giriş yapınca bütün
    // kanallarının bildirim odalarına seni koyuyor). Açık kanal değilse
    // okunmamış ve bahsedilme işaretleri; görmüyorsan masaüstü bildirimi.
    // ephemeral: tek seferlik fotoğraf; kanalda kalmadığı için sadece bildirim.
    socket.on('channel-activity', ({ channelId, serverId, username: from, text, replyToUsername, ephemeral }) => {
      if (from && from === displayNameRef.current) return
      const mention = mentionsUser(text, displayNameRef.current) || replyToUsername === displayNameRef.current
      const isActive = channelId === activeChannelRef.current
      if (!isActive && !ephemeral) {
        if (!serverId || serverId === activeServerIdRef.current) {
          setUnreadChannels((prev) => (prev.includes(channelId) ? prev : [...prev, channelId]))
          if (mention) setMentionCounts((prev) => ({ ...prev, [channelId]: (prev[channelId] || 0) + 1 }))
        } else {
          setMyServers((prev) =>
            prev.map((s) =>
              s.id === serverId ? { ...s, unread: true, mentions: (s.mentions || 0) + (mention ? 1 : 0) } : s
            )
          )
        }
      }
      if (from && !(isActive && document.hasFocus())) {
        notifyActivityRef.current?.({ channelId, serverId, from, text, mention, isActive })
      }
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
    socket.on('avatar-saved', ({ avatarUrl, avatarData }) => {
      setMyAvatar(avatarUrl || avatarData || null)
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

  // YENİ: mikrofonu DOĞRUDAN bir duruma getiren fonksiyon (toggle değil,
  // "aç" ya da "kapat" diye kesin bir komut) — hem normal buton hem de
  // bas-konuş bunu kullanıyor, mantık tek bir yerde.
  const setMicActive = useCallback(
    async (active) => {
      // Sese girerken başlayan hazırlık bitmediyse onu bekle (iki iz olmasın).
      if (micReadyRef.current) await micReadyRef.current
      const existingAudioTrack = localMainStreamRef.current?.getAudioTracks()[0]
      if (!existingAudioTrack) {
        // Hazırlık başarısız olmuştu (izin, cihaz yok): açarken tekrar dene.
        if (!active || !(await addMicTrack(true))) return
      } else {
        existingAudioTrack.enabled = active
        // Ses kapısındaki ham iz de: mikrofon kapalıyken ses hiç işlenmiyor.
        const rawTrack = micProcessorRef.current?.inputTrack
        if (rawTrack) rawTrack.enabled = active
      }
      setIsMicOn(active)
      socketRef.current?.emit('state-update', { muted: !active })
    },
    [addMicTrack]
  )

  // Seste mikrofon cihazı ya da ses işleme ayarı (gürültü bastırma, yankı
  // engelleme, otomatik ses seviyesi) değişince mikrofon yeni ayarla hemen
  // yeniden açılıyor; açık/kapalı durumu korunuyor. Eskiden bir sonraki
  // açışı bekliyordu.
  const { noiseSuppression, echoCancellation, autoGainControl } = voiceSettings
  const micSetup = [selectedAudioInput, noiseSuppression, echoCancellation, autoGainControl].join('|')
  const previousMicSetupRef = useRef(micSetup)
  useEffect(() => {
    if (previousMicSetupRef.current === micSetup) return
    previousMicSetupRef.current = micSetup
    const oldTrack = localMainStreamRef.current?.getAudioTracks()[0]
    if (!oldTrack) return
    let cancelled = false
    const processor = micProcessorRef.current
    // Aynı cihaz açıkken ses işleme ayarı değişmeyebiliyor: kapıda önce eski
    // ham izi kapatıyoruz (bu arada karşıya sessizlik gidiyor).
    processor?.stopInput()
    navigator.mediaDevices
      .getUserMedia({ audio: micConstraints(selectedAudioInput, voiceSettingsRef.current) })
      .then((stream) => {
        const track = stream.getAudioTracks()[0]
        if (cancelled || localMainStreamRef.current?.getAudioTracks()[0] !== oldTrack) {
          track.stop()
          return
        }
        track.enabled = oldTrack.enabled
        if (processor) {
          processor.setInput(track)
          return
        }
        const next = new MediaStream([
          ...localMainStreamRef.current.getTracks().filter((t) => t !== oldTrack),
          track,
        ])
        localMainStreamRef.current = next
        setLocalMainStream(next)
        setLocalTrackOnMainConnections('mic', track)
        oldTrack.stop()
      })
      .catch((err) => setMediaError(describeMediaError(err)))
    return () => {
      cancelled = true
    }
  }, [micSetup, selectedAudioInput, setLocalTrackOnMainConnections])

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
      setPttKey(null)
      setMicActive(false)
    } else {
      setIsCapturingPttKey(true)
    }
  }

  // Bir sonraki tuş (ya da farenin yan tuşu) bas-konuş tuşu oluyor. Esc
  // vazgeçiyor.
  useEffect(() => {
    if (!isCapturingPttKey) return
    const assign = (code) => {
      setIsCapturingPttKey(false)
      if (!code) return
      setPttKey(code)
      setMicActive(false) // başlangıçta kapalı — tuşa basınca açılacak
    }
    const handleKeydown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      assign(e.code === 'Escape' ? null : e.code)
    }
    const handleMousedown = (e) => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      assign(e.button === 3 ? 'Mouse4' : 'Mouse5')
    }
    window.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('mousedown', handleMousedown, true)
    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('mousedown', handleMousedown, true)
    }
  }, [isCapturingPttKey, setMicActive])

  // Masaüstünde bas-konuş tuşu işletim sistemi seviyesinde dinleniyor:
  // oyundayken, pencere arkadayken ya da tepsideyken de çalışıyor. Kanca
  // sadece seste ve bas-konuş açıkken çalışıyor; ana süreç sadece bu tuşun
  // basılıp bırakıldığını bildiriyor.
  const hasGlobalPtt = !!window.electronAPI?.setPushToTalkKey
  useEffect(() => {
    if (!hasGlobalPtt) return
    window.electronAPI.setPushToTalkKey(pttEnabled && inVoice ? pttKey : null).then((ok) => {
      if (ok === false) {
        setNotice(
          formatKeyCode(pttKey) + " tuşu arka planda dinlenemiyor. Ayarlar > Tuş atamaları'ndan başka bir tuş seç."
        )
      }
    })
  }, [hasGlobalPtt, pttEnabled, pttKey, inVoice])
  useEffect(() => {
    if (!hasGlobalPtt) return
    return () => window.electronAPI.setPushToTalkKey(null)
  }, [hasGlobalPtt])

  // Bas-konuş AKTİFKEN: tuş basılıyken mikrofon açık, bırakınca kapalı.
  // Disco öndeyken bir yazı alanına harf, rakam ya da boşluk yazmak
  // mikrofonu açmıyor (F tuşları, Ctrl, fare tuşları her zaman açıyor);
  // bırakmak her zaman kapatıyor, mikrofon açık kalmasın.
  useEffect(() => {
    if (!pttEnabled || !inVoice || !pttKey) return

    const typesText = /^(Key|Digit|Numpadd)|^(Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|IntlBackslash)$/.test(pttKey)
    const isTypingIn = (el) => typesText && (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA')
    let pressed = false
    const press = (windowFocused) => {
      if (pressed || (windowFocused && isTypingIn(document.activeElement))) return
      pressed = true
      clearDeafenIfActive()
      setMicActive(true)
    }
    const release = () => {
      if (!pressed) return
      pressed = false
      setMicActive(false)
    }

    if (hasGlobalPtt) {
      return window.electronAPI.onPushToTalk((state) => (state.pressed ? press(state.windowFocused) : release()))
    }

    const handleKeydown = (e) => e.code === pttKey && press(true)
    const handleKeyup = (e) => e.code === pttKey && release()
    const mouseCode = (e) => (e.button === 3 ? 'Mouse4' : e.button === 4 ? 'Mouse5' : null)
    const handleMousedown = (e) => mouseCode(e) === pttKey && press(true)
    const handleMouseup = (e) => mouseCode(e) === pttKey && release()
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('keyup', handleKeyup)
    window.addEventListener('mousedown', handleMousedown)
    window.addEventListener('mouseup', handleMouseup)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('keyup', handleKeyup)
      window.removeEventListener('mousedown', handleMousedown)
      window.removeEventListener('mouseup', handleMouseup)
      window.removeEventListener('blur', release)
    }
  }, [pttEnabled, pttKey, inVoice, hasGlobalPtt, setMicActive, clearDeafenIfActive])

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
    setMyAvatar(response.avatarUrl || response.avatarData || null)
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
      const list = response?.success ? response.channels || [] : []
      setChannels(list)
      // Okunmamışlar ve bahsedilmeler sunucudan (uygulama kapalıyken gelenler dahil).
      const others = list.filter((c) => c.id !== activeChannelRef.current)
      setUnreadChannels(others.filter((c) => c.unread).map((c) => c.id))
      setMentionCounts(Object.fromEntries(others.filter((c) => c.mentions > 0).map((c) => [c.id, c.mentions])))
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

  const avatarByName = useMemo(
    () =>
      new Map(
        [...onlineMembers, ...offlineMembers].filter((m) => m.avatarUrl).map((m) => [m.username, m.avatarUrl])
      ),
    [onlineMembers, offlineMembers]
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
      // Açık sunucuya tekrar tıklamak hiçbir şeyi değiştirmiyor. Eskiden
      // kanaldan ve sesten çıkarıyor, üye listesini boşaltıyordu (H33).
      if (serverId === activeServerIdRef.current) {
        setMobileSidebarOpen(false)
        return
      }
      // Ayrılınan sunucunun şeritteki işareti, o anki kanal işaretlerinden.
      const previous = activeServerIdRef.current
      if (previous && previous !== serverId) {
        const mentions = Object.values(mentionCountsRef.current).reduce((sum, n) => sum + n, 0)
        const unread = unreadChannelsRef.current.length > 0
        setMyServers((prev) => prev.map((s) => (s.id === previous ? { ...s, unread, mentions } : s)))
      }
      activeServerIdRef.current = serverId
      setActiveServerId(serverId)
      window.localStorage?.setItem('activeServerId', serverId)
      leaveChannel()
      setChannels([])
      fetchServerChannels(serverId)
      setMobileSidebarOpen(false)
    },
    [leaveChannel, fetchServerChannels]
  )

  // Kanal açık ve pencere öndeyken "okudum" bildiriliyor: açılınca, yeni
  // mesaj gelince (biraz bekleyerek) ve pencere öne gelince.
  useEffect(() => {
    if (!loggedIn || !activeChannel) return
    const markRead = () => {
      if (document.hasFocus()) socketRef.current?.emit('mark-read', { channelId: activeChannel })
    }
    const timer = setTimeout(markRead, 800)
    window.addEventListener('focus', markRead)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', markRead)
    }
  }, [loggedIn, activeChannel, messages.length])

  // Masaüstü bildirimi için izin (tarayıcıda bir kez soruluyor).
  useEffect(() => {
    if (loggedIn && notifySettings.desktop) ensureNotificationPermission()
  }, [loggedIn, notifySettings.desktop])

  // Görev çubuğundaki sayı: bütün sunuculardaki bahsedilmeler.
  const totalMentions =
    Object.values(mentionCounts).reduce((sum, n) => sum + n, 0) +
    myServers.filter((s) => s.id !== activeServerId).reduce((sum, s) => sum + (s.mentions || 0), 0)
  useEffect(() => {
    setAttentionBadge(loggedIn ? totalMentions : 0)
  }, [loggedIn, totalMentions])

  // Bildirime tıklayınca o kanal açılıyor (gerekirse sunucu da değişiyor).
  const openChannelFrom = useCallback(
    (serverId, channelId) => {
      if (serverId && serverId !== activeServerIdRef.current) selectServer(serverId)
      joinChannel(channelId)
    },
    [selectServer, joinChannel]
  )

  useEffect(() => {
    notifyActivityRef.current = ({ channelId, serverId, from, text, mention, isActive }) => {
      const settings = notifySettingsRef.current
      if (mention) {
        // Açık kanaldaki mesajın sesini mesajın kendisi çalıyor.
        if (settings.sounds && !isActive) playMentionSound()
        requestAttention()
      }
      if (!settings.desktop || (!mention && settings.mode !== 'all')) return
      const channelName = channels.find((c) => c.id === channelId)?.name
      const serverName = myServers.find((s) => s.id === serverId)?.name
      showNotification({
        title: channelName ? `${from} · #${channelName}` : serverName ? `${from} · ${serverName}` : from,
        body: text,
        tag: channelId,
        onClick: () => openChannelFrom(serverId, channelId),
      })
    }
  })

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

  const handleCreateServer = useCallback(
    async (name) => {
      setServerModalBusy(true)
      setServerModalError(null)
      const response = await emitRequest('create-server', {
        token: sessionTokenRef.current,
        name,
      })
      setServerModalBusy(false)
      if (response?.success) {
        setShowServerModal(false)
        await refreshMyServers()
        selectServer(response.server.id)
      } else {
        setServerModalError(response?.message || 'Sunucu oluşturulamadı.')
      }
    },
    [emitRequest, refreshMyServers, selectServer]
  )

  const handleJoinServer = useCallback(
    async (inviteCode) => {
      setServerModalBusy(true)
      setServerModalError(null)
      const response = await emitRequest('join-server-by-invite', {
        token: sessionTokenRef.current,
        inviteCode,
      })
      setServerModalBusy(false)
      if (response?.success) {
        setShowServerModal(false)
        await refreshMyServers()
        selectServer(response.server.id)
      } else {
        setServerModalError(response?.message || 'Sunucuya katılamadın.')
      }
    },
    [emitRequest, refreshMyServers, selectServer]
  )

  const openServerModal = useCallback(
    (tab) => {
      setServerModalTab(tab || (myServers.some((s) => s.isOwner) ? 'join' : 'create'))
      setServerModalError(null)
      setShowServerModal(true)
      setMobileSidebarOpen(false)
    },
    [myServers]
  )

  // YENİ: sunucuyu tamamen sil — sadece sahibi/platform admini
  // çağırabiliyor (arayüzden de sadece onlara gösteriliyor). Önce onay
  // penceresi açılıyor (bkz. confirmDeleteServer).
  const handleDeleteServer = useCallback(async () => {
    setConfirmDeleteServer(false)
    if (!activeServerIdRef.current) return
    const response = await emitRequest('delete-server', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
    })
    if (response?.success) {
      setServerInvitePopover(null)
      setShowAppSettings(false)
      leaveChannel()
      setActiveServerId(null)
      window.localStorage?.removeItem('activeServerId')
      await refreshMyServers()
    } else {
      setNotice(response?.message || 'Sunucu silinemedi.')
    }
  }, [emitRequest, leaveChannel, refreshMyServers])

  // Davet bağlantısının sunucusu (giriş yapmadan da soruluyor).
  useEffect(() => {
    if (!pendingInvite) return
    let cancelled = false
    setInviteInfo(null)
    emitRequest('invite-info', { code: pendingInvite }).then((response) => {
      if (!cancelled) setInviteInfo(response)
    })
    return () => {
      cancelled = true
    }
  }, [pendingInvite, emitRequest])

  const joinFromInvite = useCallback(async () => {
    setInviteJoin({ busy: true, error: null })
    const response = await emitRequest('join-server-by-invite', {
      token: sessionTokenRef.current,
      inviteCode: pendingInvite,
    })
    if (!response?.success) {
      setInviteJoin({ busy: false, error: response?.message || 'Sunucuya katılamadın.' })
      return
    }
    clearPendingInvite()
    await refreshMyServers()
    selectServer(response.server.id)
  }, [emitRequest, pendingInvite, clearPendingInvite, refreshMyServers, selectServer])

  const createInvite = useCallback(
    (options) => emitRequest('create-invite', { serverId: activeServerIdRef.current, ...options }),
    [emitRequest]
  )

  const fetchServerInvites = useCallback(async () => {
    const response = await emitRequest('list-invites', { serverId: activeServerIdRef.current })
    setServerInvites(response?.success ? response.invites : [])
  }, [emitRequest])

  const revokeInvite = useCallback(
    async (code) => {
      await emitRequest('delete-invite', { serverId: activeServerIdRef.current, code })
      fetchServerInvites()
    },
    [emitRequest, fetchServerInvites]
  )

  const openServerInvitePopover = useCallback(async () => {
    const response = await emitRequest('get-server-invite', {
      token: sessionTokenRef.current,
      serverId: activeServerIdRef.current,
    })
    if (response?.success) setServerInvitePopover({ code: response.inviteCode })
  }, [emitRequest])

  const handleCreateChannel = useCallback(
    async (name) => {
      setCreateChannelDialog({ busy: true, error: null })
      const response = await emitRequest('create-channel', {
        token: sessionTokenRef.current,
        serverId: activeServerIdRef.current,
        name,
      })
      if (response?.success) {
        setCreateChannelDialog(null)
        fetchServerChannels(activeServerIdRef.current)
      } else {
        setCreateChannelDialog({ busy: false, error: response?.message || 'Kanal oluşturulamadı.' })
      }
    },
    [emitRequest, fetchServerChannels]
  )

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

  // replyToId: yanıt verilen mesaj (komutlarda yok sayılıyor).
  const handleSendMessage = (text, replyToId) => {
    if (!text || !socketRef.current) return

    // YENİ: "!sil n" komutu — kendi son N mesajını topluca siler.
    const silMatch = text.match(/^!sil\s+(\d+)$/i)
    if (silMatch) {
      socketRef.current.emit('delete-last-n', {
        token: sessionTokenRef.current,
        n: Number(silMatch[1]),
      })
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
      return
    }

    socketRef.current.emit('send-message', { token: sessionTokenRef.current, text, replyToId })
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

  // Yazıyor göstergesi: her tuşta değil, yazmaya başlayınca ve yazmaya
  // devam ettikçe 4 saniyede bir "typing-start" gidiyor (karşı taraf 6
  // saniye haber alamazsa göstergeyi kendisi siliyor, H21); 3 saniye
  // sessizlikte "typing-stop".
  const handleTyping = () => {
    const socket = socketRef.current
    if (!socket) return
    const now = Date.now()
    if (!isTypingRef.current || now - lastTypingSentAtRef.current > TYPING_HEARTBEAT_MS) {
      isTypingRef.current = true
      lastTypingSentAtRef.current = now
      socket.emit('typing-start', { token: sessionTokenRef.current })
    }
    clearTimeout(typingStopTimeoutRef.current)
    typingStopTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false
      socketRef.current?.emit('typing-stop', { token: sessionTokenRef.current })
    }, 3000)
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
    if (showsServerMembers) {
      fetchServerMembers()
      fetchServerInvites()
    }
    // Sunucuya biri katılınca/çıkarılınca liste açıksa yenilensin (H16).
    refreshServerMembersRef.current = showsServerMembers ? fetchServerMembers : null
  }, [showAppSettings, myServers, activeServerId, fetchServerMembers, fetchServerInvites])

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

  const handleEditMessage = (messageId, newText) => {
    socketRef.current?.emit('edit-message', {
      token: sessionTokenRef.current,
      messageId,
      newText,
    })
  }
  const handleDeleteMessage = (messageId) => {
    socketRef.current?.emit('delete-message', { token: sessionTokenRef.current, messageId })
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

  // "Beni hatırla" ile kaydedilmiş bir oturum varsa, deneme sonuçlanana
  // kadar giriş formunu göstermiyoruz; yoksa her açılışta giriş ekranı bir
  // anlığına çakıp kayboluyordu.
  if (isRestoringSession) return <RestoringScreen />

  if (!loggedIn) {
    return (
      <AuthScreen
        mode={authMode}
        onSwitchMode={(mode) => {
          setAuthMode(mode)
          setLoginError(null)
          setRegisterError(null)
          if (mode === 'register') setRegisterSuccessMessage(null)
        }}
        username={username}
        onUsernameChange={setUsername}
        password={password}
        onPasswordChange={setPassword}
        showPassword={showPassword}
        onToggleShowPassword={() => setShowPassword((prev) => !prev)}
        rememberMe={rememberMe}
        onRememberMeChange={setRememberMe}
        inviteCode={inviteCode}
        onInviteCodeChange={setInviteCode}
        onLogin={handleLogin}
        onRegister={handleRegister}
        isLoggingIn={isLoggingIn}
        isRegistering={isRegistering}
        loginError={loginError}
        registerError={registerError}
        registerSuccessMessage={registerSuccessMessage}
        invite={pendingInvite ? inviteInfo : null}
      />
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
  const channelNameOf = (channelId) => channels.find((c) => c.id === channelId)?.name ?? '…'
  const activeChannelName = channels.find((c) => c.id === activeChannel)?.name || ''
  const voiceChannelName = channels.find((c) => c.id === voiceChannel)?.name || ''
  const activeServer = myServers.find((s) => s.id === activeServerId)
  const activeServerName = activeServer?.name || ''
  const activeServerIsOwner = !!activeServer?.isOwner
  // Başkasının mesajını silebilir mi: platform yöneticisi ya da bu sunucunun
  // sahibi. Sunucu sahibine zaten izin veriyordu ama arayüz düğmeyi sadece
  // platform yöneticisine gösteriyordu (H17).
  const canModerateActiveServer = isAdmin || activeServerIsOwner
  const isVoiceView = inVoice && voiceChannel === activeChannel && !!activeChannel
  const reconnecting = connectionStatus === 'reconnecting'

  const speakingUsernames = new Set(
    [...speakingIds].map((id) => (id === 'local' ? displayName : peers.find((p) => p.socketId === id)?.username))
  )
  const pingValues = Object.values(peerPings).filter((p) => typeof p === 'number')
  const averagePing = pingValues.length
    ? Math.round(pingValues.reduce((sum, p) => sum + p, 0) / pingValues.length)
    : null

  // Kenar çubuğunda her kanalın altında o kanalın sesindekiler.
  const voicersByChannel = new Map()
  for (const member of onlineMembers) {
    if (!member.voiceChannelId) continue
    const isMe = member.username === displayName
    const peer = peers.find((p) => p.username === member.username)
    const inMyVoice = inVoice && member.voiceChannelId === voiceChannel
    if (!voicersByChannel.has(member.voiceChannelId)) voicersByChannel.set(member.voiceChannelId, [])
    voicersByChannel.get(member.voiceChannelId).push({
      username: member.username,
      avatarUrl: isMe ? myAvatar : member.avatarUrl,
      speaking: inMyVoice && speakingUsernames.has(member.username),
      muted: isMe ? inVoice && !isMicOn : inMyVoice && !!peer?.muted,
    })
  }
  const voiceCountHere = voicersByChannel.get(activeChannel)?.length || 0

  const membersForMentions = [
    ...onlineMembers.map((m) => ({ ...m, online: true })),
    ...offlineMembers.map((m) => ({ ...m, online: false })),
  ]
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches
  // Sunucu şeridi: aktif sunucu kanal işaretlerinden, diğerleri listeden.
  const serverActivity = Object.fromEntries(
    myServers.map((s) => [
      s.id,
      s.id === activeServerId
        ? { unread: unreadChannels.length > 0, mentions: Object.values(mentionCounts).reduce((sum, n) => sum + n, 0) }
        : { unread: !!s.unread, mentions: s.mentions || 0 },
    ])
  )
  const membersVisible = !isVoiceView && (membersPanelOpen || mobileMembersOpen)

  const chatPanel = activeChannel && (
    <ChatPanel
      variant={isVoiceView ? 'side' : 'full'}
      channelName={activeChannelName}
      items={chatTimeline}
      avatars={avatarByName}
      newSince={newMessagesSince}
      members={membersForMentions}
      displayName={displayName}
      canModerate={canModerateActiveServer}
      hasMoreHistory={hasMoreHistory}
      isLoadingOlder={isLoadingOlder}
      onLoadOlder={handleLoadOlderMessages}
      typingUsers={typingUsers}
      onSend={handleSendMessage}
      onTyping={handleTyping}
      onPhotoFile={sendPhotoFile}
      isSendingPhoto={isSendingPhoto}
      onReact={handleToggleReaction}
      onEdit={handleEditMessage}
      onDelete={handleDeleteMessage}
      onOpenPhoto={setPhotoLightbox}
      messagesRef={chatMessagesRef}
    />
  )

  let mainContent
  if (connectionError) {
    mainContent = (
      <div className="empty-state" role="alert">
        <ServerCrash className="icon empty-state-icon" />
        <p className="empty-state-title">{connectionError}</p>
        <p className="empty-state-text">Soldan başka bir kanal ya da sunucu seçebilirsin.</p>
      </div>
    )
  } else if (myServers.length === 0) {
    mainContent = (
      <div className="empty-state">
        <Compass className="icon empty-state-icon" />
        <p className="empty-state-title">Henüz bir sunucun yok</p>
        <p className="empty-state-text">
          Arkadaşlarınla konuşmak için kendi sunucunu oluştur ya da sana gönderilen davet koduyla katıl.
        </p>
        <div className="empty-state-actions">
          <button type="button" className="btn" onClick={() => openServerModal('create')}>
            <Plus className="icon" />
            Sunucu oluştur
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => openServerModal('join')}>
            Davet koduyla katıl
          </button>
        </div>
      </div>
    )
  } else if (!activeChannel) {
    mainContent = (
      <div className="empty-state">
        <Compass className="icon empty-state-icon" />
        <p className="empty-state-title">Bir kanal seç</p>
        <p className="empty-state-text">
          Soldaki listeden bir kanala gir. Seste kim varsa kanalın altında görünüyor.
        </p>
        <button type="button" className="btn btn--secondary mobile-only" onClick={() => setMobileSidebarOpen(true)}>
          Kanal listesini aç
        </button>
      </div>
    )
  } else if (isVoiceView) {
    mainContent = (
      <div className={'channel-body channel-body--voice' + (voiceChatOpen ? '' : ' channel-body--chat-hidden')}>
        <VoiceStage
          displayName={displayName}
          myAvatar={myAvatar}
          localStream={localMainStream}
          localScreenStream={localScreenStream}
          localVideoRef={localVideoRef}
          localScreenVideoRef={localScreenVideoRef}
          peers={peers}
          remoteStreams={remoteStreams}
          peerPings={peerPings}
          speakingIds={speakingIds}
          enlargedTile={enlargedTile}
          onToggleEnlarge={toggleEnlarge}
          onOpenVolume={openVolumePopup}
          outputDeviceId={selectedAudioOutput}
          mediaError={mediaError}
          onDismissMediaError={() => setMediaError(null)}
          controls={{
            isMicOn,
            isDeafened,
            isCameraOn,
            isScreenSharing,
            pttEnabled,
            pttKey,
            onToggleMic: toggleMic,
            onToggleDeafen: toggleDeafen,
            onToggleCamera: toggleCamera,
            onToggleScreenShare: toggleScreenShare,
            onLeave: leaveVoice,
          }}
        />
        {voiceChatOpen && chatPanel}
      </div>
    )
  } else {
    mainContent = (
      <div className="channel-body">
        {chatPanel}
        {membersVisible && (
          <div className={'member-drawer' + (mobileMembersOpen ? ' member-drawer--open' : '')}>
            <MemberList
              online={onlineMembers}
              offline={offlineMembers}
              displayName={displayName}
              channelNameOf={channelNameOf}
              speakingUsernames={speakingUsernames}
              onOpenVolume={openVolumePopup}
              onClose={() => setMobileMembersOpen(false)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className={'nav-drawer' + (mobileSidebarOpen ? ' nav-drawer--open' : '')}>
        <ServerRail
          servers={myServers}
          activeServerId={activeServerId}
          activity={serverActivity}
          onSelect={selectServer}
          onAdd={() => openServerModal()}
        />
        <ChannelSidebar
          server={activeServer}
          channels={channels}
          activeChannel={activeChannel}
          unreadChannels={unreadChannels}
          mentionCounts={mentionCounts}
          voiceChannel={voiceChannel}
          inVoice={inVoice}
          voicersByChannel={voicersByChannel}
          onOpenChannel={(channelId) => {
            joinChannel(channelId)
            setMobileSidebarOpen(false)
          }}
          onJoinVoiceIn={(channelId) => {
            joinChannel(channelId)
            joinVoice()
            setMobileSidebarOpen(false)
          }}
          onInvite={openServerInvitePopover}
          onCreateChannel={() => setCreateChannelDialog({ busy: false, error: null })}
          onOpenServerSettings={() => openSettings('server')}
          onAddServer={() => openServerModal()}
          onClose={() => setMobileSidebarOpen(false)}
          voicePanel={
            inVoice && {
              channelName: voiceChannelName,
              ping: averagePing,
              reconnecting,
              isScreenSharing,
              onOpenChannel: () => {
                joinChannel(voiceChannel)
                setMobileSidebarOpen(false)
              },
              onToggleScreenShare: toggleScreenShare,
              onLeave: leaveVoice,
            }
          }
          userPanel={{
            displayName,
            avatarUrl: myAvatar,
            speaking: speakingIds.has('local'),
            inVoice,
            isMicOn,
            isDeafened,
            pttEnabled,
            pttKey,
            onToggleMic: toggleMic,
            onToggleDeafen: toggleDeafen,
            onOpenSettings: () => openSettings(),
          }}
          update={
            updateReady
              ? { ready: true, onInstall: () => window.electronAPI?.installUpdate() }
              : updateInfo && updateProgress !== null
                ? { ready: false, progress: updateProgress }
                : null
          }
        />
      </div>
      {(mobileSidebarOpen || mobileMembersOpen) && (
        <div
          className="mobile-backdrop"
          onClick={() => {
            setMobileSidebarOpen(false)
            setMobileMembersOpen(false)
          }}
        />
      )}

      <main className="main-panel">
        <ChannelHeader
          title={activeChannel && !connectionError ? activeChannelName : activeServerName || 'Disco'}
          isChannel={!!activeChannel && !connectionError}
          voiceCount={voiceCountHere}
          showJoinVoice={!!activeChannel && !connectionError && !inVoice}
          onJoinVoice={joinVoice}
          membersOpen={isNarrow() ? mobileMembersOpen : membersPanelOpen}
          onToggleMembers={
            activeChannel && !connectionError && !isVoiceView
              ? () => (isNarrow() ? setMobileMembersOpen((open) => !open) : setMembersPanelOpen((open) => !open))
              : null
          }
          chatToggle={isVoiceView ? { open: voiceChatOpen, onToggle: () => setVoiceChatOpen((open) => !open) } : null}
          onOpenNav={() => setMobileSidebarOpen(true)}
        />
        {reconnecting && (
          <div className="status-banner status-banner--warn reconnecting-banner" role="status">
            <WifiOff className="icon" />
            Bağlantı koptu, yeniden bağlanılıyor…
          </div>
        )}
        {notice && notice !== connectionError && (
          <div className="status-banner notice-banner" role="status">
            <AlertTriangle className="icon" />
            {notice}
          </div>
        )}
        {mainContent}
      </main>

      {showAppSettings && (
        <SettingsScreen
          initialPage={settingsInitialPage}
          onClose={() => setShowAppSettings(false)}
          onLogout={handleLogout}
          account={{
            displayName,
            avatarUrl: myAvatar,
            onAvatarFile: uploadAvatar,
            isUploadingAvatar,
            avatarError: avatarUploadError,
          }}
          audio={{
            inputs: audioInputs,
            outputs: audioOutputs,
            selectedInput: selectedAudioInput,
            selectedOutput: selectedAudioOutput,
            onSelectInput: setSelectedAudioInput,
            onSelectOutput: setSelectedAudioOutput,
            isTestingMic,
            onTestMic: testMicrophone,
            // Seviye çubuğu: seste kapının kendisi, değilse mikrofon testi.
            levelSource: micProcessor || micTestProcessor,
            isLive: !!micProcessor,
            pushToTalk: pttEnabled,
            voice: voiceSettings,
            onVoiceChange: (patch) => setVoiceSettings((prev) => ({ ...prev, ...patch })),
            onTestTone: playTestTone,
            outputError: outputDeviceError,
          }}
          ptt={{
            enabled: pttEnabled,
            key: pttKey,
            isCapturing: isCapturingPttKey,
            isGlobal: hasGlobalPtt,
            onToggle: handleTogglePtt,
          }}
          notifications={{
            ...notifySettings,
            onChange: (patch) => {
              setNotifySettings((prev) => ({ ...prev, ...patch }))
              if (patch.desktop) ensureNotificationPermission()
            },
          }}
          desktop={
            window.electronAPI?.setCloseToTray
              ? {
                  closeToTray,
                  onCloseToTrayChange: setCloseToTray,
                  openAtLogin,
                  onOpenAtLoginChange: changeOpenAtLogin,
                }
              : null
          }
          appearance={{
            theme,
            onThemeChange: setTheme,
            zoomLevel,
            onZoomIn: zoomIn,
            onZoomOut: zoomOut,
            onZoomReset: zoomReset,
            isFullscreen,
            onToggleFullscreen: toggleFullscreen,
          }}
          update={{
            appVersion,
            ready: updateReady,
            version: updateInfo?.version,
            message: updateCheckMessage,
            onInstall: () => window.electronAPI?.installUpdate(),
            onCheck: () => {
              setUpdateCheckMessage('Kontrol ediliyor…')
              window.electronAPI?.checkForUpdates()
            },
          }}
          server={
            activeServerIsOwner
              ? {
                  name: activeServerName,
                  members: serverMembers,
                  onRemoveMember: removeServerMember,
                  onShowInvite: openServerInvitePopover,
                  invites: serverInvites,
                  onRevokeInvite: revokeInvite,
                  onDelete: () => setConfirmDeleteServer(true),
                }
              : null
          }
          admin={
            isAdmin
              ? {
                  users: allUsers,
                  isLoadingUsers,
                  usersError: userManagementError,
                  roleInputs: roleInputByUser,
                  onRoleInputChange: (targetUsername, value) =>
                    setRoleInputByUser((prev) => ({ ...prev, [targetUsername]: value })),
                  onAddRole: addRoleToUser,
                  onRemoveRole: removeRoleFromUser,
                  onUnlock: unlockUserLogin,
                  bans: bannedIps,
                  isLoadingBans: isLoadingBannedIps,
                  onUnban: unbanIp,
                }
              : null
          }
        />
      )}

      {screenSourceOptions && (
        <ScreenPicker sources={screenSourceOptions} onSelect={handleSelectScreenSource} onCancel={handleCancelScreenSource} />
      )}

      {volumePopup && (
        <VolumePopover
          username={volumePopup.username}
          x={volumePopup.x}
          y={volumePopup.y}
          volume={peerVolumes[volumePopup.username] ?? 100}
          onChange={(value) => setPeerVolume(volumePopup.username, value)}
          onClose={() => setVolumePopup(null)}
        />
      )}

      {photoLightbox && <PhotoLightbox src={photoLightbox} onClose={() => setPhotoLightbox(null)} />}

      {showServerModal && (
        <ServerDialog
          initialTab={serverModalTab}
          hasOwnServer={myServers.some((s) => s.isOwner)}
          busy={serverModalBusy}
          error={serverModalError}
          onCreate={handleCreateServer}
          onJoin={handleJoinServer}
          onClose={() => setShowServerModal(false)}
        />
      )}

      {serverInvitePopover && (
        <InviteDialog
          serverName={activeServerName}
          permanentCode={serverInvitePopover.code}
          onCreate={createInvite}
          onClose={() => setServerInvitePopover(null)}
        />
      )}

      {createChannelDialog && (
        <CreateChannelDialog
          busy={createChannelDialog.busy}
          error={createChannelDialog.error}
          onCreate={handleCreateChannel}
          onClose={() => setCreateChannelDialog(null)}
        />
      )}

      {confirmDeleteServer && (
        <ConfirmDialog
          title={`${activeServerName} silinsin mi?`}
          message="Sunucunun bütün kanalları ve mesajları da silinecek. Bu geri alınamaz."
          confirmLabel="Sunucuyu sil"
          onConfirm={handleDeleteServer}
          onClose={() => setConfirmDeleteServer(false)}
        />
      )}

      {securityAlert && <SecurityAlertDialog alert={securityAlert} onClose={() => setSecurityAlert(null)} />}

      {pendingInvite && (
        <JoinInviteDialog
          code={pendingInvite}
          info={inviteInfo}
          isMember={!!inviteInfo?.server && myServers.some((s) => s.id === inviteInfo.server.id)}
          busy={inviteJoin.busy}
          error={inviteJoin.error}
          onJoin={joinFromInvite}
          onGoTo={() => {
            selectServer(inviteInfo.server.id)
            clearPendingInvite()
          }}
          onClose={clearPendingInvite}
        />
      )}
    </div>
  )
}

export default App
