// Ana alanın başlığı: kanal adı, seste kaç kişi olduğu, "Sese katıl" ve
// sohbet/üye panellerini açıp kapatan düğmeler. Telefonda kanal
// çekmecesini açan düğme de burada.
import { useState } from 'react'
import { AtSign, Hash, Headphones, Menu, MessageSquare, Phone, Pin, Search, Users } from 'lucide-react'

// Mesajlarda arama: Enter arar, Esc temizler. "from:Ece" ile kişiye göre.
function SearchBox({ scopeLabel, onSearch, onClear }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="header-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSearch(value.trim())
      }}
    >
      <Search className="icon" aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={`${scopeLabel} içinde ara`}
        aria-label={`${scopeLabel} içinde ara`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('')
            onClear()
          }
        }}
      />
    </form>
  )
}

// isDm: özel mesaj (başlıkta @, "Sese katıl" yerine "Sesli ara").
export function ChannelHeader({
  title,
  isChannel,
  isDm = false,
  voiceCount,
  showJoinVoice,
  onJoinVoice,
  membersOpen,
  onToggleMembers,
  chatToggle,
  onOpenNav,
  search,
  pins,
}) {
  return (
    <header className="channel-header">
      <button type="button" className="icon-btn mobile-only" onClick={onOpenNav} aria-label="Kanalları göster">
        <Menu className="icon" />
      </button>
      {isChannel && (isDm ? <AtSign className="icon channel-header-hash" /> : <Hash className="icon channel-header-hash" />)}
      <h2 className="channel-header-title">{title}</h2>
      {isChannel && voiceCount > 0 && (
        <span className="channel-header-voice">
          <span className="live-dot" aria-hidden="true" />
          {voiceCount} kişi seste
        </span>
      )}
      <div className="channel-header-actions">
        {search && <SearchBox scopeLabel={search.scopeLabel} onSearch={search.onSearch} onClear={search.onClear} />}
        {pins && (
          <button
            type="button"
            className="icon-btn"
            aria-pressed={pins.open}
            onClick={pins.onToggle}
            aria-label="Sabitlenmiş mesajlar"
            title="Sabitlenmiş mesajlar"
          >
            <Pin className="icon" />
          </button>
        )}
        {showJoinVoice && (
          <button type="button" className="btn btn--small join-voice-button" onClick={onJoinVoice}>
            {isDm ? <Phone className="icon" /> : <Headphones className="icon" />}
            {isDm ? 'Sesli ara' : 'Sese katıl'}
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
