// Kanal kenar çubuğu: sunucu başlığı ve menüsü, kanal listesi (seste kim
// varsa kanalın altında), altta "Ses bağlı" paneli ve kullanıcı paneli.
import { useCallback, useRef, useState } from 'react'
import {
  ChevronDown,
  Hash,
  Headphones,
  HeadphoneOff,
  Link,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Plus,
  Settings,
  Signal,
  Download,
  UserPlus,
  Volume2,
  X,
} from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { useDismiss } from '../lib/useDismiss.js'
import { formatKeyCode } from '../lib/format.js'

function ServerHeader({ name, isOwner, onInvite, onCreateChannel, onOpenServerSettings, onAddServer, onClose }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const close = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuRef, menuOpen, close)

  const run = (action) => () => {
    setMenuOpen(false)
    action()
  }

  return (
    <div className="sidebar-header" ref={menuRef}>
      <button
        type="button"
        className="sidebar-server-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="sidebar-server-name">{name}</span>
        <ChevronDown className="icon" />
      </button>
      <button type="button" className="icon-btn mobile-only" onClick={onClose} aria-label="Kanalları kapat">
        <X className="icon" />
      </button>
      {menuOpen && (
        <div className="popover sidebar-server-menu" role="menu">
          {isOwner && (
            <>
              <button type="button" role="menuitem" className="menu-item" onClick={run(onInvite)}>
                <UserPlus className="icon" /> Arkadaşını davet et
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={run(onCreateChannel)}>
                <Plus className="icon" /> Kanal oluştur
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={run(onOpenServerSettings)}>
                <Settings className="icon" /> Sunucu ayarları
              </button>
              <div className="menu-separator" />
            </>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={run(onAddServer)}>
            <Link className="icon" /> Sunucu oluştur ya da katıl
          </button>
        </div>
      )}
    </div>
  )
}

function ChannelRow({ channel, active, unread, mentions, isMyVoice, voicers, canJoinVoice, onOpen, onJoinVoice }) {
  return (
    <li className="channel-row">
      <button
        type="button"
        className={
          'channel-button' +
          (active ? ' channel-button--active' : '') +
          (unread ? ' channel-button--unread' : '')
        }
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        <Hash className="icon channel-hash" />
        <span className="channel-name">{channel.name}</span>
        {isMyVoice && <Volume2 className="icon channel-voice-indicator" aria-label="Bu kanalın sesindesin" />}
        {mentions > 0 ? (
          <span className="mention-badge" aria-label={`${mentions} kez bahsedildin`}>
            {mentions > 99 ? '99+' : mentions}
          </span>
        ) : (
          unread && <span className="channel-unread-dot" aria-label="Okunmamış mesaj var" />
        )}
      </button>
      {canJoinVoice && (
        <button
          type="button"
          className="icon-btn channel-join-voice"
          onClick={onJoinVoice}
          aria-label={`${channel.name} sesine katıl`}
          title="Sese katıl"
        >
          <Headphones className="icon" />
        </button>
      )}
      {voicers.length > 0 && (
        <ul className="channel-voicers" aria-label={`${channel.name} sesinde`}>
          {voicers.map((v) => (
            <li key={v.username} className={'channel-voicer' + (v.speaking ? ' is-speaking' : '')}>
              <Avatar name={v.username} src={v.avatarUrl} size="xs" speaking={v.speaking} />
              <span className="channel-voicer-name">{v.username}</span>
              {v.muted && <MicOff className="icon channel-voicer-muted" aria-label="Mikrofonu kapalı" />}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function VoicePanel({ channelName, ping, reconnecting, isScreenSharing, onOpenChannel, onToggleScreenShare, onLeave }) {
  return (
    <section className="voice-panel" aria-label="Ses bağlantısı">
      <div className="voice-panel-info">
        <strong className={'voice-panel-status' + (reconnecting ? ' voice-panel-status--warn' : '')}>
          <Signal className="icon" />
          {reconnecting ? 'Yeniden bağlanıyor…' : 'Ses bağlı'}
        </strong>
        <button type="button" className="voice-panel-channel" onClick={onOpenChannel} title="Kanala git">
          #{channelName}
          {typeof ping === 'number' && <span className="voice-panel-ping"> · {ping} ms</span>}
        </button>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={isScreenSharing}
        onClick={onToggleScreenShare}
        aria-label={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
        title={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
      >
        {isScreenSharing ? <MonitorOff className="icon" /> : <Monitor className="icon" />}
      </button>
      <button type="button" className="icon-btn icon-btn--danger voice-panel-leave" onClick={onLeave} aria-label="Sesten çık" title="Sesten çık">
        <PhoneOff className="icon" />
      </button>
    </section>
  )
}

function UserPanel({
  displayName,
  avatarUrl,
  speaking,
  inVoice,
  isMicOn,
  isDeafened,
  pttEnabled,
  pttKey,
  onToggleMic,
  onToggleDeafen,
  onOpenSettings,
}) {
  const micLabel = !inVoice
    ? 'Mikrofon (sese katılınca açılır)'
    : pttEnabled
      ? `Bas-konuş açık (${formatKeyCode(pttKey)})`
      : isMicOn
        ? 'Mikrofonu kapat'
        : 'Mikrofonu aç'
  return (
    <section className="user-panel" aria-label="Kullanıcı paneli">
      <Avatar name={displayName} src={avatarUrl} size="sm" status="online" speaking={speaking} />
      <div className="user-panel-text">
        <strong className="whoami">{displayName}</strong>
        <span>{pttEnabled ? `Bas-konuş: ${formatKeyCode(pttKey)}` : 'Çevrimiçi'}</span>
      </div>
      <button
        type="button"
        className={'icon-btn' + (inVoice && !isMicOn ? ' icon-btn--off' : '')}
        onClick={onToggleMic}
        disabled={!inVoice || pttEnabled}
        aria-label={micLabel}
        title={micLabel}
      >
        {inVoice && !isMicOn ? <MicOff className="icon" /> : <Mic className="icon" />}
      </button>
      <button
        type="button"
        className={'icon-btn' + (isDeafened ? ' icon-btn--off' : '')}
        onClick={onToggleDeafen}
        disabled={!inVoice}
        aria-label={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
        title={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
      >
        {isDeafened ? <HeadphoneOff className="icon" /> : <Headphones className="icon" />}
      </button>
      <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Ayarlar" title="Ayarlar">
        <Settings className="icon" />
      </button>
    </section>
  )
}

export function ChannelSidebar({
  server,
  channels,
  activeChannel,
  unreadChannels,
  mentionCounts,
  voiceChannel,
  inVoice,
  voicersByChannel,
  onOpenChannel,
  onJoinVoiceIn,
  onInvite,
  onCreateChannel,
  onOpenServerSettings,
  onAddServer,
  onClose,
  voicePanel,
  userPanel,
  update,
}) {
  return (
    <aside className="channel-sidebar" aria-label="Kanallar">
      {server ? (
        <ServerHeader
          name={server.name}
          isOwner={server.isOwner}
          onInvite={onInvite}
          onCreateChannel={onCreateChannel}
          onOpenServerSettings={onOpenServerSettings}
          onAddServer={onAddServer}
          onClose={onClose}
        />
      ) : (
        <div className="sidebar-header">
          <span className="sidebar-server-name">Disco</span>
          <button type="button" className="icon-btn mobile-only" onClick={onClose} aria-label="Kanalları kapat">
            <X className="icon" />
          </button>
        </div>
      )}

      <div className="sidebar-scroll">
        {server && (
          <div className="sidebar-category">
            <span>Kanallar</span>
            {server.isOwner && (
              <button
                type="button"
                className="icon-btn icon-btn--small"
                onClick={onCreateChannel}
                aria-label="Kanal oluştur"
                title="Kanal oluştur"
              >
                <Plus className="icon" />
              </button>
            )}
          </div>
        )}
        <ul className="channel-list">
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              active={activeChannel === channel.id}
              unread={unreadChannels.includes(channel.id)}
              mentions={mentionCounts[channel.id] || 0}
              isMyVoice={inVoice && voiceChannel === channel.id}
              voicers={voicersByChannel.get(channel.id) || []}
              canJoinVoice={!inVoice}
              onOpen={() => onOpenChannel(channel.id)}
              onJoinVoice={() => onJoinVoiceIn(channel.id)}
            />
          ))}
        </ul>
      </div>

      {update && (
        <div className="update-banner" role="status">
          {update.ready ? (
            <button type="button" className="update-banner-button" onClick={update.onInstall}>
              <Download className="icon" />
              Güncelleme hazır, yeniden başlat
            </button>
          ) : (
            <span className="update-banner-progress">
              Güncelleme iniyor… %{update.progress}
              <span className="update-banner-bar" style={{ '--progress': `${update.progress}%` }} />
            </span>
          )}
        </div>
      )}
      {voicePanel && <VoicePanel {...voicePanel} />}
      <UserPanel {...userPanel} />
    </aside>
  )
}
