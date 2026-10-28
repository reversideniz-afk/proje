// Sağdaki üye listesi: sunucunun çevrimiçi ve çevrimdışı üyeleri, seste
// olanın hangi kanalda olduğu ve konuşuyorsa Spot ışığı. Bir kişiye
// tıklayınca (ya da sağ tıklayınca) ses seviyesi ayarı açılıyor.
import { Volume2, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'

function MemberItem({ member, online, isMe, channelName, speaking, onOpenVolume }) {
  const content = (
    <>
      <Avatar
        name={member.username}
        src={member.avatarUrl}
        size="sm"
        status={online ? 'online' : null}
        speaking={speaking}
      />
      <span className="member-item-text">
        <span className="member-item-name">
          {member.username}
          {isMe && <span className="member-item-you"> (sen)</span>}
        </span>
        {member.inVoice && (
          <span className={'member-item-activity' + (speaking ? ' is-speaking' : '')} title={`Seste: #${channelName}`}>
            <Volume2 className="icon" />
            {speaking ? `#${channelName} kanalında konuşuyor` : `#${channelName} sesinde`}
          </span>
        )}
      </span>
    </>
  )
  const className = `member-item member-item--${online ? 'online' : 'offline'}`
  if (isMe) return <li className={className}>{content}</li>
  return (
    <li className={className}>
      <button
        type="button"
        className="member-item-button"
        onClick={(e) => onOpenVolume(member.username, e)}
        onContextMenu={(e) => onOpenVolume(member.username, e)}
        aria-label={`${member.username}: ses seviyesini ayarla`}
        title="Ses seviyesini ayarla"
      >
        {content}
      </button>
    </li>
  )
}

export function MemberList({ online, offline, displayName, channelNameOf, speakingUsernames, onOpenVolume, onClose }) {
  return (
    <aside className="member-list-panel" aria-label="Üyeler">
      <div className="member-list-head mobile-only">
        <strong>Üyeler</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Üyeleri kapat">
          <X className="icon" />
        </button>
      </div>
      <section className="member-list-section">
        <h3 className="member-list-title">Çevrimiçi — {online.length}</h3>
        <ul>
          {online.map((m) => (
            <MemberItem
              key={m.username}
              member={m}
              online
              isMe={m.username === displayName}
              channelName={channelNameOf(m.voiceChannelId)}
              speaking={speakingUsernames.has(m.username)}
              onOpenVolume={onOpenVolume}
            />
          ))}
        </ul>
      </section>
      {offline.length > 0 && (
        <section className="member-list-section">
          <h3 className="member-list-title">Çevrimdışı — {offline.length}</h3>
          <ul>
            {offline.map((m) => (
              <MemberItem
                key={m.username}
                member={m}
                online={false}
                isMe={false}
                speaking={false}
                onOpenVolume={onOpenVolume}
              />
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
