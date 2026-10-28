// Ana alanın başlığı: kanal adı, seste kaç kişi olduğu, "Sese katıl" ve
// sohbet/üye panellerini açıp kapatan düğmeler. Telefonda kanal
// çekmecesini açan düğme de burada.
import { Hash, Headphones, Menu, MessageSquare, Users } from 'lucide-react'

export function ChannelHeader({
  title,
  isChannel,
  voiceCount,
  showJoinVoice,
  onJoinVoice,
  membersOpen,
  onToggleMembers,
  chatToggle,
  onOpenNav,
}) {
  return (
    <header className="channel-header">
      <button type="button" className="icon-btn mobile-only" onClick={onOpenNav} aria-label="Kanalları göster">
        <Menu className="icon" />
      </button>
      {isChannel && <Hash className="icon channel-header-hash" />}
      <h2 className="channel-header-title">{title}</h2>
      {isChannel && voiceCount > 0 && (
        <span className="channel-header-voice">
          <span className="live-dot" aria-hidden="true" />
          {voiceCount} kişi seste
        </span>
      )}
      <div className="channel-header-actions">
        {showJoinVoice && (
          <button type="button" className="btn btn--small join-voice-button" onClick={onJoinVoice}>
            <Headphones className="icon" />
            Sese katıl
          </button>
        )}
        {chatToggle && (
          <button
            type="button"
            className="icon-btn"
            aria-pressed={chatToggle.open}
            onClick={chatToggle.onToggle}
            aria-label={chatToggle.open ? 'Sohbeti gizle' : 'Sohbeti göster'}
            title={chatToggle.open ? 'Sohbeti gizle' : 'Sohbeti göster'}
          >
            <MessageSquare className="icon" />
          </button>
        )}
        {onToggleMembers && (
          <button
            type="button"
            className="icon-btn"
            aria-pressed={membersOpen}
            onClick={onToggleMembers}
            aria-label={membersOpen ? 'Üyeleri gizle' : 'Üyeleri göster'}
            title={membersOpen ? 'Üyeleri gizle' : 'Üyeleri göster'}
          >
            <Users className="icon" />
          </button>
        )}
      </div>
    </header>
  )
}
