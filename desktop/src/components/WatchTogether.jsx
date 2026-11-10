// Birlikte izleme: seste olan herkes aynı YouTube videosunu aynı anda
// izliyor. Ortak durum sunucuda (hangi video, oynuyor mu, hangi saniyede);
// buradaki oynatıcı kendini o duruma göre ayarlıyor ve sapınca düzeltiyor.
// Oynatıcının kendi düğmeleri kapalı (videoya tıklamak da bizim düğmemize
// gidiyor): biri durdurunca herkeste duruyor.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Tv, Volume2, VolumeX, X } from 'lucide-react'
import { Dialog } from './Dialog.jsx'
import { YOUTUBE_ORIGIN, formatVideoTime, youtubeEmbedUrl, youtubeVideoId } from '../lib/youtube.js'

// Bu kadar saniyeden fazla saparsa ortak konuma atlıyor.
const DRIFT_SECONDS = 2
const ACTION_LABELS = { start: 'başlattı', play: 'oynattı', pause: 'duraklattı', seek: 'ileri/geri sardı' }

// Oynatıcının hata kodları (YouTube): 100 yok/gizli, 101/150 sahibi başka
// sitelerde oynatılmasına izin vermiyor, 153 oynatıcı ayarı.
function errorText(code) {
  if (code === 100) return 'Bu video bulunamadı ya da gizli.'
  if (code === 101 || code === 150) return 'Bu videonun sahibi başka uygulamalarda oynatılmasına izin vermiyor. Başka bir video dene.'
  return 'Video oynatılamadı.'
}

function readVolume() {
  try {
    const value = Number(window.localStorage.getItem('watchVolume'))
    return Number.isFinite(value) && window.localStorage.getItem('watchVolume') !== null ? value : 80
  } catch {
    return 80
  }
}

// Ortak konum (saniye): oynuyorsa son değişiklikten beri geçen süre ekleniyor.
function expectedPosition(watch) {
  const { session, offset } = watch
  if (!session.playing) return session.position
  return session.position + (Date.now() + offset - session.updatedAt) / 1000
}

export function WatchPanel({ watch, onControl, onStop }) {
  const { session } = watch
  const iframeRef = useRef(null)
  const [player, setPlayer] = useState({ ready: false, time: 0, duration: 0, state: -1, error: null })
  const playerRef = useRef(player)
  playerRef.current = player
  const watchRef = useRef(watch)
  watchRef.current = watch
  const [volume, setVolume] = useState(readVolume)
  const [scrub, setScrub] = useState(null) // kaydırıcı sürüklenirken

  const post = useCallback((func, args = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), YOUTUBE_ORIGIN)
  }, [])

  // Oynatıcının bildirimleri (konum, süre, durum).
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      let data
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (!data || typeof data !== 'object') return
      if (data.event === 'onReady') setPlayer((prev) => ({ ...prev, ready: true }))
      if (data.event === 'onError') setPlayer((prev) => ({ ...prev, error: Number(data.info) || 0 }))
      if (data.event === 'infoDelivery' || data.event === 'initialDelivery') {
        const info = data.info || {}
        setPlayer((prev) => ({
          ...prev,
          ready: true,
          time: typeof info.currentTime === 'number' ? info.currentTime : prev.time,
          duration: typeof info.duration === 'number' && info.duration > 0 ? info.duration : prev.duration,
          state: typeof info.playerState === 'number' ? info.playerState : prev.state,
        }))
      }
      if (data.event === 'onStateChange' && typeof data.info === 'number') {
        setPlayer((prev) => ({ ...prev, state: data.info }))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Oynatıcı yüklenince "dinliyorum" deniyor; hazır olana kadar tekrarlanıyor.
  const handleLoad = useCallback(() => {
    let tries = 0
    const timer = setInterval(() => {
      if (playerRef.current.ready || tries++ > 40) {
        clearInterval(timer)
        return
      }
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YOUTUBE_ORIGIN)
    }, 250)
  }, [])

  // Ortak duruma uy: değişince hemen, sonra saniyede bir sapma denetimi.
  const sync = useCallback(
    (force) => {
      const current = playerRef.current
      if (!current.ready) return
      const target = expectedPosition(watchRef.current)
      if (force || Math.abs(current.time - target) > DRIFT_SECONDS) post('seekTo', [Math.max(0, target), true])
      const playing = watchRef.current.session.playing
      if (playing && current.state !== 1 && current.state !== 3) post('playVideo')
      if (!playing && (current.state === 1 || current.state === 3 || force)) post('pauseVideo')
    },
    [post]
  )
  useEffect(() => {
    sync(true)
  }, [session.videoId, session.playing, session.position, session.updatedAt, player.ready, sync])
  useEffect(() => {
    const timer = setInterval(() => sync(false), 1000)
    return () => clearInterval(timer)
  }, [sync])

  useEffect(() => {
    if (!player.ready) return
    post('setVolume', [volume])
    post(volume === 0 ? 'mute' : 'unMute')
  }, [player.ready, volume, post])

  const togglePlay = () => onControl(session.playing ? 'pause' : 'play', expectedPosition(watch))
  const shownTime = scrub ?? (player.ready ? player.time : expectedPosition(watch))
  const duration = player.duration || 0
  const lastAction = watch.by && ACTION_LABELS[watch.action] ? `${watch.by} ${ACTION_LABELS[watch.action]}` : null

  return (
    <section className="watch-panel" aria-label="Birlikte izle">
      <div className="watch-screen">
        <iframe
          ref={iframeRef}
          key={session.videoId}
          src={youtubeEmbedUrl(session.videoId)}
          title={session.title || 'YouTube videosu'}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={handleLoad}
        />
        {player.error !== null && (
          <p className="watch-error" role="alert">
            {errorText(player.error)}
          </p>
        )}
        {/* Videoya tıklamak oynatıcıya değil bize geliyor: herkeste aynı olsun. */}
        <button
          type="button"
          className="watch-overlay"
          onClick={togglePlay}
          aria-label={session.playing ? 'Herkes için duraklat' : 'Herkes için oynat'}
          tabIndex={-1}
        />
      </div>
      <div className="watch-bar">
        <button
          type="button"
          className="icon-btn watch-play"
          onClick={togglePlay}
          aria-label={session.playing ? 'Duraklat' : 'Oynat'}
          title={session.playing ? 'Herkes için duraklat' : 'Herkes için oynat'}
        >
          {session.playing ? <Pause className="icon" /> : <Play className="icon" />}
        </button>
        <span className="watch-time">
          {formatVideoTime(shownTime)}
          {duration > 0 && ` / ${formatVideoTime(duration)}`}
        </span>
        <input
          type="range"
          className="watch-seek"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={1}
          value={Math.min(Math.floor(shownTime), Math.max(1, Math.floor(duration)))}
          disabled={duration <= 0}
          aria-label="Videoda konum"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub !== null) onControl('seek', scrub)
            setScrub(null)
          }}
          onKeyUp={(e) => {
            if (scrub !== null && e.key !== 'Tab') {
              onControl('seek', scrub)
              setScrub(null)
            }
          }}
        />
        <span className="watch-volume">
          {volume === 0 ? <VolumeX className="icon" aria-hidden="true" /> : <Volume2 className="icon" aria-hidden="true" />}
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            aria-label="Video sesi (sadece sende)"
            onChange={(e) => {
              const value = Number(e.target.value)
              setVolume(value)
              try {
                window.localStorage.setItem('watchVolume', String(value))
              } catch {
                // Saklanamazsa bu oturumluk.
              }
            }}
          />
        </span>
        <button type="button" className="icon-btn" onClick={onStop} aria-label="Birlikte izlemeyi bitir" title="Herkes için bitir">
          <X className="icon" />
        </button>
      </div>
      <p className="watch-caption">
        <Tv className="icon" aria-hidden="true" />
        <span className="watch-title">{session.title || 'YouTube videosu'}</span>
        {lastAction && <span className="watch-note"> · {lastAction}</span>}
      </p>
    </section>
  )
}

// Seste "Birlikte izle": YouTube bağlantısı yapıştırılıyor.
export function WatchDialog({ busy, error, onStart, onClose }) {
  const [link, setLink] = useState('')
  const videoId = youtubeVideoId(link)
  return (
    <Dialog title="Birlikte izle" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (videoId) onStart(videoId)
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="watch-link">
            YouTube bağlantısı
          </label>
          <input
            id="watch-link"
            className="input"
            value={link}
            placeholder="https://www.youtube.com/watch?v=…"
            autoFocus
            onChange={(e) => setLink(e.target.value)}
          />
          <p className="field-hint">
            Seste olan herkes aynı videoyu aynı anda izler; biri durdurunca herkeste durur. Sesini herkes kendi ayarlar.
          </p>
          {link.trim() && !videoId && <p className="form-error">Bu bir YouTube video bağlantısı değil.</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="btn" disabled={!videoId || busy}>
            Başlat
          </button>
        </div>
      </form>
    </Dialog>
  )
}
