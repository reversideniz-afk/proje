// Telefonda Discord'daki gibi: sohbeti sağa kaydırınca kanal listesi, sola
// kaydırınca üye listesi açılıyor; açıkken ters yöne kaydırınca kapanıyor.
// Çekmece parmağı takip ediyor; bırakınca yarıdan fazlası açıksa (ya da
// hızlıca kaydırıldıysa) açık kalıyor. Dikey kaydırma, yatay kayan alanlar
// (kod blokları, ses ekranındaki şerit, kaydırıcılar) ve açık pencereler
// çekmeceleri oynatmıyor.
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

const NARROW = '(max-width: 760px)'
// Yön bu kadar hareketten sonra belli oluyor (px).
const LOCK_DISTANCE = 10
// Bırakırken bu hızın (px/ms) üstündeyse yarıya varmasa da açılıp kapanıyor.
const FLING_SPEED = 0.35
// Hareketin başlayabileceği yerler: sohbet/ses alanı ve çekmecelerin kendisi.
const SWIPE_AREAS = '.main-panel, .nav-drawer, .member-drawer, .mobile-backdrop'

function ignoresSwipe(target, root) {
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.matches('input[type="range"], [role="dialog"]')) return true
    if (node.scrollWidth > node.clientWidth + 1) {
      const { overflowX } = getComputedStyle(node)
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
  }
  return false
}

// navOpen/membersOpen: çekmecelerin şu anki durumu; onNav/onMembers(open):
// hareket bitince çekmecenin açık kalıp kalmayacağı.
export function useSwipeDrawers({ navOpen, membersOpen, onNav, onMembers }) {
  const latest = useRef(null)
  latest.current = { navOpen, membersOpen, onNav, onMembers }

  useEffect(() => {
    let gesture = null

    const finish = (open) => {
      const { drawer } = gesture
      gesture = null
      if (!drawer) return
      // Önce çekmecenin yeni durumu işleniyor, sonra elle verilen konum
      // kaldırılıyor: geçiş, parmağın bıraktığı yerden başlıyor.
      flushSync(() => (drawer.kind === 'nav' ? latest.current.onNav(open) : latest.current.onMembers(open)))
      for (const el of [drawer.el, drawer.backdrop]) {
        if (!el) continue
        el.style.transition = ''
        el.style.transform = ''
        el.style.visibility = ''
        el.style.opacity = ''
      }
    }

    const onStart = (e) => {
      gesture = null
      if (e.touches.length !== 1 || !window.matchMedia(NARROW).matches) return
      const root = document.querySelector('.app-shell')
      const target = e.target
      if (!root?.contains(target) || !target.closest(SWIPE_AREAS) || ignoresSwipe(target, root)) return
      const touch = e.touches[0]
      gesture = { root, x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastTime: e.timeStamp, speed: 0, drawer: null }
    }

    const begin = (dx) => {
      const { navOpen, membersOpen } = latest.current
      let kind = null
      if (navOpen) kind = dx < 0 ? 'nav' : null
      else if (membersOpen) kind = dx > 0 ? 'members' : null
      else kind = dx > 0 ? 'nav' : 'members'
      const el = kind && gesture.root.querySelector(kind === 'nav' ? '.nav-drawer' : '.member-drawer')
      if (!el) return null
      const width = el.offsetWidth
      const wasOpen = kind === 'nav' ? navOpen : membersOpen
      const closedAt = kind === 'nav' ? -width : width
      const backdrop = gesture.root.querySelector('.mobile-backdrop')
      for (const node of [el, backdrop]) {
        if (node) node.style.transition = 'none'
      }
      el.style.visibility = 'visible'
      return { kind, el, backdrop, width, closedAt, startAt: wasOpen ? 0 : closedAt, offset: null, wasOpen }
    }

    const onMove = (e) => {
      if (!gesture) return
      const touch = e.touches[0]
      const dx = touch.clientX - gesture.x
      const dy = touch.clientY - gesture.y
      if (!gesture.drawer) {
        if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return
        gesture.drawer = Math.abs(dx) > Math.abs(dy) ? begin(dx) : null
        if (!gesture.drawer) {
          gesture = null
          return
        }
      }
      e.preventDefault()
      const elapsed = e.timeStamp - gesture.lastTime
      if (elapsed > 0) gesture.speed = (touch.clientX - gesture.lastX) / elapsed
      gesture.lastX = touch.clientX
      gesture.lastTime = e.timeStamp

      const drawer = gesture.drawer
      drawer.offset = Math.min(Math.max(drawer.startAt + dx, Math.min(drawer.closedAt, 0)), Math.max(drawer.closedAt, 0))
      drawer.el.style.transform = `translateX(${drawer.offset}px)`
      if (drawer.backdrop) drawer.backdrop.style.opacity = String(1 - Math.abs(drawer.offset) / drawer.width)
    }

    const onEnd = (e) => {
      if (!gesture) return
      const drawer = gesture.drawer
      if (!drawer) {
        gesture = null
        return
      }
      if (e.type === 'touchcancel') {
        finish(drawer.wasOpen)
        return
      }
      // Açılma yönündeki hız: kanal listesi sağa, üye listesi sola açılıyor.
      const speed = drawer.kind === 'nav' ? gesture.speed : -gesture.speed
      const openRatio = 1 - Math.abs(drawer.offset ?? drawer.startAt) / drawer.width
      finish(speed > FLING_SPEED || (speed > -FLING_SPEED && openRatio > 0.5))
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])
}
