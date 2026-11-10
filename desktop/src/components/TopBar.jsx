// Masaüstünün üst çubuğu: dönen küçük top ve "Disco", sunucunun menüsü,
// ortada kanal şeridi (kategoriler yan yana gruplar, sürükleyerek
// sıralanıyor), sağda güncelleme ve sen.
import { Settings, Volume2 } from 'lucide-react'
import { ChannelList, ServerHeader, UpdateBanner, UserPanel } from './ChannelSidebar.jsx'
import { DiscoBall } from './DiscoBall.jsx'
import { ballColorOf } from '../lib/discoBall.js'

function RibbonChannel({ channel, active, unread, mentions, isMyVoice, voicers, onOpen, onEdit, dragProps }) {
  const live = voicers.length > 0
  return (
    <li
      {...dragProps}
      className={'channel-row' + (onEdit ? ' channel-row--editable' : '') + (dragProps?.className ? ` ${dragProps.className}` : '')}
    >
      <button
        type="button"
        className={'channel-button' + (active ? ' channel-button--active' : '') + (unread ? ' channel-button--unread' : '')}
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        {live && (
          <span
            className="channel-live"
            style={{ '--ball-color': ballColorOf(channel) }}
            role="img"
            aria-label={`${voicers.length} kişi seste`}
          />
        )}
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
      {onEdit && (
        <button type="button" className="channel-edit" onClick={onEdit} aria-label={`${channel.name} kanalını düzenle`} title="Kanalı düzenle">
          <Settings className="icon" />
        </button>
      )}
    </li>
  )
}

export function TopBar({
  home,
  server,
  serverMenu,
  channels,
  categories,
  activeChannel,
  unreadChannels,
  mentionCounts,
  voiceChannel,
  inVoice,
  voicersByChannel,
  onOpenChannel,
  onEditChannel,
  onCreateChannel,
  onEditCategory,
  onMoveChannel,
  onMoveCategory,
  update,
  userPanel,
}) {
  const manage = !!server?.permissions?.manageChannels
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <DiscoBall color="#C9B8E8" size={32} facets={5} speed={9} glow={false} />
        <span className="topbar-name">Disco</span>
      </div>
      {home ? (
        <div className="sidebar-header">
          <span className="sidebar-server-name">Özel mesajlar</span>
        </div>
      ) : (
        server && <ServerHeader name={server.name} permissions={server.permissions || {}} {...serverMenu} onClose={() => {}} />
      )}
      {!home && server ? (
        <nav className="channel-ribbon" aria-label="Kanallar">
          <div className="ribbon-track">
            <ChannelList
              variant="ribbon"
              channels={channels}
              categories={categories}
              manage={manage}
              activeChannel={activeChannel}
              myVoiceChannel={inVoice ? voiceChannel : null}
              onCreateChannel={onCreateChannel}
              onEditCategory={onEditCategory}
              onMoveChannel={onMoveChannel}
              onMoveCategory={onMoveCategory}
              renderChannel={(channel, dragProps) => (
                <RibbonChannel
                  key={channel.id}
                  channel={channel}
                  active={activeChannel === channel.id}
                  unread={unreadChannels.includes(channel.id)}
                  mentions={mentionCounts[channel.id] || 0}
                  isMyVoice={inVoice && voiceChannel === channel.id}
                  voicers={voicersByChannel.get(channel.id) || []}
                  onOpen={() => onOpenChannel(channel.id)}
                  onEdit={manage ? () => onEditChannel(channel) : null}
                  dragProps={dragProps}
                />
              )}
            />
          </div>
        </nav>
      ) : (
        <div className="topbar-spacer" />
      )}
      {update && <UpdateBanner update={update} />}
      <UserPanel {...userPanel} compact />
    </header>
  )
}
