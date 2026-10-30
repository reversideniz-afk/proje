// Sağdaki üye listesi: sunucunun çevrimiçi ve çevrimdışı üyeleri, seste
// olanın hangi kanalda olduğu ve konuşuyorsa Spot ışığı. Bir kişiye
// tıklayınca (ya da sağ tıklayınca) ses seviyesi ayarı açılıyor.
import { Gamepad2, Volume2, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { statusLabel } from '../lib/presence.js'
import { hoistedRoleOf, roleColorOf } from '../lib/roles.js'

// Çevrimiçiler: "üye listesinde ayrı göster" rolü olanlar en üstteki o
// rolün başlığı altında (rol sırasıyla), kalanlar "Çevrimiçi" altında.
function groupOnline(online, roles) {
  const byRole = new Map()
  const rest = []
  for (const member of online) {
    const role = hoistedRoleOf(member.roleIds, roles)
    if (!role) rest.push(member)
    else byRole.set(role.id, [...(byRole.get(role.id) || []), member])
  }
  const groups = roles.filter((r) => byRole.has(r.id)).map((r) => ({ key: r.id, title: r.name, members: byRole.get(r.id) }))
  if (rest.length > 0 || groups.length === 0) groups.push({ key: 'online', title: 'Çevrimiçi', members: rest })
  return groups
}

// Adın altındaki satır: konuşuyorsa o, oyun oynuyorsa oyun, seste ise
// hangi kanal, yoksa özel durumu.
function MemberLine({ member, online, channelName, speaking }) {
  if (!online) return null
  if (member.inVoice && speaking) {
    return (
      <span className="member-item-activity is-speaking" title={`Seste: #${channelName}`}>
        <Volume2 className="icon" />#{channelName} kanalında konuşuyor
      </span>
    )
  }
  if (online && member.activity) {
    return (
      <span className="member-item-activity member-item-game" title={`${member.activity} oynuyor`}>
        <Gamepad2 className="icon" />
        <strong>{member.activity}</strong> oynuyor
      </span>
    )
  }
  if (member.inVoice) {
    return (
      <span className="member-item-activity" title={`Seste: #${channelName}`}>
        <Volume2 className="icon" />#{channelName} sesinde
      </span>
    )
  }
  if (member.customStatus) {
    return (
      <span className="member-item-activity" title={member.customStatus}>
        {member.customStatus}
      </span>
    )
  }
  return null
}

function MemberItem({ member, online, isMe, channelName, speaking, color, onOpenVolume }) {
  const status = online ? member.status || 'online' : 'offline'
  const content = (
    <>
      <Avatar name={member.username} src={member.avatarUrl} size="sm" status={online ? status : null} speaking={speaking} />
      <span className="member-item-text">
        <span className="member-item-name" style={color && online ? { color } : undefined}>
          {member.username}
          {isMe && <span className="member-item-you"> (sen)</span>}
          {online && status !== 'online' && <span className="visually-hidden">, {statusLabel(status)}</span>}
        </span>
        <MemberLine member={member} online={online} channelName={channelName} speaking={speaking} />
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

export function MemberList({ online, offline, roles = [], displayName, channelNameOf, speakingUsernames, onOpenVolume, onClose }) {
  return (
    <aside className="member-list-panel" aria-label="Üyeler">
      <div className="member-list-head mobile-only">
        <strong>Üyeler</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Üyeleri kapat">
          <X className="icon" />
        </button>
      </div>
      {groupOnline(online, roles).map((group) => (
        <section key={group.key} className="member-list-section">
          <h3 className="member-list-title">
            {group.title} — {group.members.length}
          </h3>
          <ul>
            {group.members.map((m) => (
              <MemberItem
                key={m.username}
                member={m}
                online
                isMe={m.username === displayName}
                channelName={channelNameOf(m.voiceChannelId)}
                speaking={speakingUsernames.has(m.username)}
                color={roleColorOf(m.roleIds, roles)}
                onOpenVolume={onOpenVolume}
              />
            ))}
          </ul>
        </section>
      ))}
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
