// Ses sahnesi: seste olan herkesin kutucuğu ve altta ortada ses kontrolleri.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PartyPopper,
  PhoneOff,
  Video,
  VideoOff,
  X,
} from 'lucide-react'
import { RemoteCameraTile } from './RemoteCameraTile.jsx'
import { RemoteScreenTile } from './RemoteScreenTile.jsx'
import { StageTile } from './StageTile.jsx'
import { formatKeyCode } from '../lib/format.js'
import { SOUNDS } from '../lib/soundboard.js'
import { useDismiss } from '../lib/useDismiss.js'
import './VoiceStage.css'

function LocalVideo({ videoRef, stream, className }) {
  // Kutucuk yeniden çizildiğinde (ör. büyütülünce) görüntü kaybolmasın.
  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream
  })
  return <video ref={videoRef} autoPlay playsInline muted className={className} />
}

function VoiceControls({
  isMicOn,
  isDeafened,
  isCameraOn,
  isScreenSharing,
  pttEnabled,
  pttKey,
  onToggleMic,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreenShare,
  onPlaySound,
  onLeave,
}) {
  const [soundboardOpen, setSoundboardOpen] = useState(false)
  const soundboardRef = useRef(null)
  const closeSoundboard = useCallback(() => setSoundboardOpen(false), [])
  useDismiss(soundboardRef, soundboardOpen, closeSoundboard)
  const micTitle = pttEnabled
    ? `Bas-konuş açık (${formatKeyCode(pttKey)}) — konuşmak için tuşu basılı tut`
    : isMicOn
      ? 'Mikrofonu kapat'
      : 'Mikrofonu aç'
  return (
    <div className="voice-controls media-controls" role="toolbar" aria-label="Ses kontrolleri">
      <button
        type="button"
        className={'voice-control' + (isMicOn ? '' : ' voice-control--off')}
        onClick={pttEnabled ? undefined : onToggleMic}
        disabled={pttEnabled}
        title={micTitle}
        aria-label={micTitle}
      >
        {isMicOn ? <Mic className="icon" /> : <MicOff className="icon" />}
      </button>
      <button
        type="button"
        className={'voice-control' + (isDeafened ? ' voice-control--off' : '')}
        onClick={onToggleDeafen}
        title={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır (herkesi sustur)'}
        aria-label={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır (herkesi sustur)'}
      >
        {isDeafened ? <HeadphoneOff className="icon" /> : <Headphones className="icon" />}
      </button>
      <button
        type="button"
        className={'voice-control' + (isCameraOn ? ' voice-control--live' : '')}
        onClick={onToggleCamera}
        title={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
        aria-label={isCameraOn ? 'Kamerayı kapat' : 'Kamerayı aç'}
      >
        {isCameraOn ? <Video className="icon" /> : <VideoOff className="icon" />}
      </button>
      <button
        type="button"
        className={'voice-control' + (isScreenSharing ? ' voice-control--live' : '')}
        onClick={onToggleScreenShare}
        title={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
        aria-label={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
      >
        {isScreenSharing ? <MonitorOff className="icon" /> : <Monitor className="icon" />}
      </button>
      {onPlaySound && (
        <div className="soundboard" ref={soundboardRef}>
          <button
            type="button"
            className="voice-control"
            onClick={() => setSoundboardOpen((open) => !open)}
            title="Ses efektleri"
            aria-label="Ses efektleri"
            aria-expanded={soundboardOpen}
          >
            <PartyPopper className="icon" />
          </button>
          {soundboardOpen && (
            <div className="popover soundboard-panel" role="menu" aria-label="Ses efektleri">
              {SOUNDS.map((sound) => (
                <button
                  key={sound.id}
                  type="button"
                  role="menuitem"
                  className="soundboard-sound"
                  onClick={() => onPlaySound(sound.id)}
                >
                  <span className="soundboard-emoji" aria-hidden="true">
                    {sound.emoji}
                  </span>
                  {sound.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="voice-control voice-control--leave leave-voice-button"
        onClick={onLeave}
        title="Sesten çık"
        aria-label="Sesten çık"
      >
        <PhoneOff className="icon" />
      </button>
    </div>
  )
}

const TILE_GAP = 12

// Kutucukları sahneye en büyük hâlleriyle sığdıran sütun sayısı: her sütun
// sayısı için 16:9 kutucuğun alabileceği en geniş boyu hesaplayıp en
// büyüğünü seçiyor (iki kişi geniş ekranda yan yana, dar ekranda alt alta).
function bestLayout(count, width, height) {
  let best = { columns: 1, tileWidth: 0 }
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.min(
      (width - TILE_GAP * (columns - 1)) / columns,
      ((height - TILE_GAP * (rows - 1)) / rows) * (16 / 9)
    )
    if (tileWidth > best.tileWidth) best = { columns, tileWidth }
  }
  return best
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export function VoiceStage({
  displayName,
  myAvatar,
  localStream,
  localScreenStream,
  localVideoRef,
  localScreenVideoRef,
  peers,
  remoteStreams,
  peerPings,
  speakingIds,
  enlargedTile,
  onToggleEnlarge,
  onOpenVolume,
  outputDeviceId,
  mediaError,
  onDismissMediaError,
  soundToast,
  controls,
}) {
  const gridRef = useRef(null)
  const gridSize = useElementSize(gridRef)
  const tiles = [
    <StageTile
      key="local-camera"
      className="tile--local"
      name={displayName}
      label="Sen"
      avatarUrl={myAvatar}
      muted={!controls.isMicOn}
      speaking={speakingIds.has('local')}
      showAvatar={!controls.isCameraOn}
      media={controls.isCameraOn ? <LocalVideo videoRef={localVideoRef} stream={localStream} className="local-video" /> : null}
      isEnlarged={enlargedTile === 'local-camera'}
      onToggleEnlarge={() => onToggleEnlarge('local-camera')}
    />,
  ]
  if (controls.isScreenSharing) {
    tiles.push(
      <StageTile
        key="local-screen"
        className="tile--local tile--screen"
        name={displayName}
        label="Sen · ekran"
        live
        media={
          <LocalVideo videoRef={localScreenVideoRef} stream={localScreenStream} className="local-video local-video--screen" />
        }
        isEnlarged={enlargedTile === 'local-screen'}
        onToggleEnlarge={() => onToggleEnlarge('local-screen')}
      />
    )
  }
  for (const [socketId, streams] of Object.entries(remoteStreams)) {
    const peer = peers.find((p) => p.socketId === socketId)
    const label = peer ? peer.username : '…'
    if (streams.mainStream) {
      tiles.push(
        <RemoteCameraTile
          key={`${socketId}-camera`}
          stream={streams.mainStream}
          label={label}
          cameraOn={peer ? peer.cameraOn : false}
          micOn={peer ? !peer.muted : false}
          speaking={speakingIds.has(socketId)}
          isEnlarged={enlargedTile === `${socketId}-camera`}
          onToggleEnlarge={() => onToggleEnlarge(`${socketId}-camera`)}
          onOpenVolumeMenu={(e) => peer && onOpenVolume(peer.username, e)}
          ping={peerPings[socketId]}
          avatarUrl={peer?.avatarUrl}
        />
      )
    }
    if (peer?.sharingScreen && streams.screenStream) {
      tiles.push(
        <RemoteScreenTile
          key={`${socketId}-screen`}
          stream={streams.screenStream}
          label={label}
          isEnlarged={enlargedTile === `${socketId}-screen`}
          onToggleEnlarge={() => onToggleEnlarge(`${socketId}-screen`)}
          outputDeviceId={outputDeviceId}
        />
      )
    }
  }

  // Büyütülen kutucuk sahneyi dolduruyor, diğerleri altta bir şeride
  // iniyor; yandaki sohbet açık kalıyor (yayını izlerken yazışmak için).
  const focused = enlargedTile ? tiles.find((tile) => tile.key === enlargedTile) : null
  const tileWidth = Math.max(0, Math.floor(bestLayout(tiles.length, gridSize.width, gridSize.height).tileWidth))

  return (
    <section className="voice-stage" aria-label="Ses sahnesi">
      <div ref={gridRef} className={'stage-area' + (focused ? ' stage-area--focus' : '')}>
        {focused ? (
          <>
            <div className="stage-focus">{focused}</div>
            {tiles.length > 1 && (
              <div className="stage-strip" aria-label="Sesteki diğer kişiler">
                {tiles.filter((tile) => tile !== focused)}
              </div>
            )}
          </>
        ) : (
          <div className="stage-grid video-grid" style={{ '--tile-width': `${tileWidth}px` }}>
            {tiles}
          </div>
        )}
      </div>
      {soundToast && (
        <div key={soundToast.key} className="stage-toast" role="status">
          <span aria-hidden="true">{soundToast.sound.emoji}</span>
          <strong>{soundToast.username}</strong> {soundToast.sound.label}
        </div>
      )}
      {mediaError && (
        <div className="stage-error" role="alert">
          <span>{mediaError}</span>
          <button type="button" className="icon-btn" onClick={onDismissMediaError} aria-label="Uyarıyı kapat">
            <X className="icon" />
          </button>
        </div>
      )}
      <VoiceControls {...controls} />
    </section>
  )
}
