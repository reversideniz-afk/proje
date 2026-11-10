// Dans pisti: sesteki herkes ortadaki ayna topun etrafında. Konuşanın
// avatarı gelen sesin gücüne göre büyüyüp küçülüyor, üstüne topun ışığı
// düşüyor. Altında ses kontrolleri. Seste olduğun sürece hangi kanala
// bakarsan bak görünüyor (eski "Ses bağlı" panelinin yerinde).
import { useEffect, useRef } from 'react'
import { MicOff, Signal, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { DiscoBall } from './DiscoBall.jsx'
import { VoiceControls } from './VoiceStage.jsx'
import { rmsOf } from '../lib/speaking.js'

// Sessizlikten (≈0,01) bağırmaya (≈0,13) kadar 0-1 arası bir seviye.
const levelOf = (rms) => Math.max(0, Math.min(1, (rms - 0.01) * 8))

// Pistteki yerler: alt ortanın iki yanına eşit aralıkla yayılıyor. Sol üst
// çeyrek (kanalın adı orada) ve tepe (topun ipi) hep boş kalıyor; en fazla
// 255 derecelik bir yay kullanılıyor.
function angleOf(index, count) {
  if (count <= 1) return 90
  const step = Math.min(360 / count, 255 / (count - 1))
  return 90 + (index - (count - 1) / 2) * step
}

// Seviyeyi React'e uğramadan, her ekran karesinde (saniyede ~30 kez) CSS
// değişkenine yazıyor: --level (kişide) ve ışığın yönü (pistte).
function useLevelMeter(floorRef, getLevelSources, anglesRef) {
  useEffect(() => {
    if (!getLevelSources) return undefined
    const buffers = new WeakMap()
    const levels = new Map()
    let frame = 0
    let last = 0
    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      if (now - last < 33) return
      last = now
      const floor = floorRef.current
      if (!floor) return
      let loudest = null
      let loudestLevel = 0
      for (const [id, analyser] of getLevelSources()) {
        const target = levelOf(rmsOf(analyser, buffers))
        const prev = levels.get(id) || 0
        // Hızlı yükseliyor, yavaş iniyor: kelime aralarında titremesin.
        const level = prev + (target - prev) * (target > prev ? 0.55 : 0.18)
        levels.set(id, level)
        const dancer = floor.querySelector(`[data-dancer="${CSS.escape(id)}"]`)
        const value = level < 0.005 ? '0' : level.toFixed(2)
        if (dancer && dancer.style.getPropertyValue('--level') !== value) dancer.style.setProperty('--level', value)
        if (level > loudestLevel && anglesRef.current.has(id)) {
          loudest = id
          loudestLevel = level
        }
      }
      const beamOn = loudest && loudestLevel > 0.04 ? Math.min(1, 0.35 + loudestLevel).toFixed(2) : '0'
      if (beamOn !== '0') floor.style.setProperty('--beam-angle', `${anglesRef.current.get(loudest)}deg`)
      if (floor.style.getPropertyValue('--beam-on') !== beamOn) floor.style.setProperty('--beam-on', beamOn)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [floorRef, getLevelSources, anglesRef])
}

export function DanceFloor({
  title,
  isDm = false,
  color,
  ping,
  reconnecting,
  dancers,
  speakingIds,
  getLevelSources,
  onOpenChannel,
  onOpenVolume,
  controls,
  soundToast,
  mediaError,
  onDismissMediaError,
  compact = false,
  // Telefonda birlikte izlerken pist kartı gizleniyor (sadece kontroller).
  collapsed = false,
}) {
  const floorRef = useRef(null)
  const anglesRef = useRef(new Map())
  const shown = dancers.slice(0, 12)
  const hidden = dancers.length - shown.length
  anglesRef.current = new Map(shown.map((d, i) => [d.id, angleOf(i, shown.length)]))
  useLevelMeter(floorRef, getLevelSources, anglesRef)

  const crowded = shown.length > 6
  const speaker = dancers.find((d) => speakingIds.has(d.id))
  const people = `${dancers.length} kişi pistte`
  return (
    <section
      className={'voice-stage dance-floor' + (compact ? ' dance-floor--compact' : '') + (collapsed ? ' dance-floor--collapsed' : '')}
      aria-label="Ses bağlantısı"
    >
      <div className="floor-card" ref={floorRef} style={{ '--ball-color': color }}>
        <div className="floor-head">
          <button type="button" className="floor-title" onClick={onOpenChannel} title="Kanala git">
            {isDm ? `@${title}` : title}
          </button>
          <span className={'floor-sub' + (reconnecting ? ' floor-sub--warn' : '')}>
            {reconnecting ? (
              <>
                <Signal className="icon" aria-hidden="true" /> Yeniden bağlanıyor…
              </>
            ) : compact && speaker ? (
              <>
                {dancers.length} kişi ·{' '}
                <strong className="floor-speaker">{speaker.isMe ? 'sen konuşuyorsun' : `${speaker.username} konuşuyor`}</strong>
              </>
            ) : (
              <>
                {people}
                {typeof ping === 'number' && ` · ${ping} ms`}
              </>
            )}
          </span>
        </div>

        <div className={'floor-ring' + (crowded ? ' floor-ring--crowded' : '')}>
          <span className="floor-beam" aria-hidden="true" />
          <span className="floor-wire" aria-hidden="true" />
          <DiscoBall color={color} size={compact ? 72 : 96} className="floor-ball" />
          <ul className="floor-dancers" aria-label={`${title} sesinde`}>
            {shown.map((d) => {
              const angle = (anglesRef.current.get(d.id) * Math.PI) / 180
              const speaking = speakingIds.has(d.id)
              const content = (
                <>
                  <span className="dancer-halo" aria-hidden="true" />
                  <span className="dancer-avatar">
                    <Avatar name={d.username} src={d.avatarUrl} size="md" />
                  </span>
                </>
              )
              return (
                <li
                  key={d.id}
                  data-dancer={d.id}
                  className={
                    'dancer' + (speaking ? ' is-speaking' : '') + (d.muted ? ' is-muted' : '') + (d.isMe ? ' dancer--me' : '')
                  }
                  style={{ left: `${(50 + 50 * Math.cos(angle)).toFixed(2)}%`, top: `${(50 + 50 * Math.sin(angle)).toFixed(2)}%` }}
                >
                  {d.isMe || !onOpenVolume ? (
                    <span className="dancer-body">{content}</span>
                  ) : (
                    <button
                      type="button"
                      className="dancer-body"
                      onClick={(e) => onOpenVolume(d.username, e)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        onOpenVolume(d.username, e)
                      }}
                      aria-label={`${d.username}: ses ayarı`}
                      title={`${d.username} · ses ayarı`}
                    >
                      {content}
                    </button>
                  )}
                  <span className="dancer-tag">
                    {d.muted && <MicOff className="icon" aria-label="Mikrofonu kapalı" />}
                    <span className="dancer-name">{d.isMe ? 'Sen' : d.username}</span>
                    {d.isMe && <span className="visually-hidden"> ({d.username})</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {hidden > 0 && <span className="floor-more">+{hidden} kişi daha</span>}
        {soundToast && (
          <div key={soundToast.key} className="stage-toast" role="status">
            <span aria-hidden="true">{soundToast.sound.emoji}</span>
            <strong>{soundToast.username}</strong> {soundToast.sound.label}
          </div>
        )}
      </div>
      {mediaError && (
        <div className="stage-error" role="alert">
          <span>{mediaError}</span>
          <button type="button" className="icon-btn" onClick={onDismissMediaError} aria-label="Uyarıyı kapat">
            <X className="icon" />
          </button>
        </div>
      )}
      <VoiceControls {...controls} compact={compact} />
    </section>
  )
}
