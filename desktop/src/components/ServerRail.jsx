// Sunucular: masaüstünde alttaki dock (imleç ekranın alt kenarına gelince
// yukarı kayıyor, uzaklaşınca aşağı iniyor), telefonda soldan gelen
// çekmecenin üstündeki sıra. Her sunucunun kendi görseli var; GIF olan
// durağan duruyor, üzerine gelince oynuyor.
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle, Plus } from 'lucide-react'
import { assetUrl } from '../lib/config.js'
import { serverInitials } from '../lib/format.js'
import { userColor } from '../lib/userColor.js'

// GIF simge: ilk karesi bir tuvalde duruyor, asıl GIF üstte saydam; üzerine
// gelince (ya da klavyeyle odaklanınca) GIF görünüp oynuyor.
function ServerIcon({ url }) {
  const src = assetUrl(url)
  const animated = /[?&]a=1(&|$)/.test(url)
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!animated) return undefined
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      const size = 88
      canvas.width = size
      canvas.height = size
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [animated, src])
  if (!animated) return <img className="server-rail-image" src={src} alt="" draggable="false" />
  return (
    <span className="server-rail-image server-icon--gif">
      <canvas ref={canvasRef} className="server-icon-still" aria-hidden="true" />
      <img className="server-icon-anim" src={src} alt="" draggable="false" />
    </span>
  )
}

// activity: sunucu kimliği -> { unread, mentions } (okunmamış işareti ve
// bahsedilme sayısı). Sayılar simgenin üstüne değil altına yazılıyor.
// homeBadge: okunmamış özel mesaj ve gelen arkadaşlık isteği sayısı.
export function ServerRail({ servers, activeServerId, activity, homeActive, homeBadge = 0, onHome, onSelect, onAdd }) {
  return (
    <nav className="server-rail" aria-label="Sunucular">
      {servers.map((server) => {
        const active = server.id === activeServerId
        const { unread = false, mentions = 0 } = activity[server.id] || {}
        const status = mentions > 0 ? `, ${mentions} bahsedilme` : unread ? ', okunmamış mesaj var' : ''
        return (
          <button
            key={server.id}
            type="button"
            className={
              'server-rail-icon' +
              (active ? ' server-rail-icon--active' : '') +
              (unread && !active ? ' server-rail-icon--unread' : '')
            }
            title={server.name}
            aria-label={server.name + status}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(server.id)}
            style={{ '--server-color': userColor(server.name) }}
          >
            <span className="server-rail-face">
              {server.iconUrl ? <ServerIcon url={server.iconUrl} /> : serverInitials(server.name)}
            </span>
            {mentions > 0 && !active ? (
              <span className="server-rail-count" aria-hidden="true">
                {mentions > 99 ? '99+' : mentions}
              </span>
            ) : (
              <span className="server-rail-dot" aria-hidden="true" />
            )}
          </button>
        )
      })}
      <span className="server-rail-divider" aria-hidden="true" />
      <button
        type="button"
        className={'server-rail-home' + (homeActive ? ' server-rail-home--active' : '')}
        onClick={onHome}
        title="Özel mesajlar ve arkadaşlar"
        aria-label={'Özel mesajlar' + (homeBadge > 0 ? `, ${homeBadge} yeni` : '')}
        aria-current={homeActive ? 'true' : undefined}
      >
        <MessageCircle className="icon" />
        {homeBadge > 0 && (
          <span className="server-rail-home-count" aria-hidden="true">
            {homeBadge > 99 ? '99+' : homeBadge}
          </span>
        )}
      </button>
      <button
        type="button"
        className="server-rail-icon server-rail-icon--add"
        title="Sunucu oluştur ya da katıl"
        aria-label="Sunucu oluştur ya da katıl"
        onClick={onAdd}
      >
        <span className="server-rail-face">
          <Plus className="icon" />
        </span>
        <span className="server-rail-dot" aria-hidden="true" />
      </button>
    </nav>
  )
}

// macOS'taki gizlenen dock gibi: imleç pencerenin alt kenarına değince
// yaylanarak yukarı çıkıyor, dock'tan çıkınca kısa bir beklemeden sonra
// aşağı kayıyor. Klavyeyle içine gelince de açılıyor. Gizliyken altta ince
// bir çizgi yerini belli ediyor.
const HIDE_DELAY_MS = 450

export function Dock({ children }) {
  const [shown, setShown] = useState(false)
  const hideTimer = useRef(0)
  const pointerInside = useRef(false)
  const pointerAtEdge = useRef(false)
  const dockRef = useRef(null)
  const show = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    setShown(true)
  }, [])
  // Fareyle tıklanan düğme odağı tutuyor ama dock'u açık tutmasın; sadece
  // klavyeyle gelinen odak (:focus-visible) tutuyor.
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (pointerInside.current || pointerAtEdge.current) return
      if (dockRef.current?.querySelector(':focus-visible')) return
      setShown(false)
    }, HIDE_DELAY_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  return (
    <>
      <div
        className="dock-hotzone"
        aria-hidden="true"
        onPointerEnter={() => {
          pointerAtEdge.current = true
          show()
        }}
        onPointerLeave={() => {
          pointerAtEdge.current = false
          scheduleHide()
        }}
      />
      <span className={'dock-hint' + (shown ? ' dock-hint--hidden' : '')} aria-hidden="true" />
      <div
        ref={dockRef}
        className={'dock' + (shown ? ' dock--shown' : '')}
        onPointerEnter={() => {
          pointerInside.current = true
          show()
        }}
        onPointerLeave={() => {
          pointerInside.current = false
          scheduleHide()
        }}
        onFocus={show}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) scheduleHide()
        }}
      >
        {children}
      </div>
    </>
  )
}
