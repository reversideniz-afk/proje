// En soldaki sunucu şeridi: her sunucu bir simge, en altta "sunucu ekle".
import { Plus } from 'lucide-react'
import logoUrl from '../assets/logo.png'
import { serverInitials } from '../lib/format.js'

// activity: sunucu kimliği -> { unread, mentions } (okunmamış işareti ve
// bahsedilme sayısı).
export function ServerRail({ servers, activeServerId, activity, onSelect, onAdd }) {
  return (
    <nav className="server-rail" aria-label="Sunucular">
      <img src={logoUrl} alt="Disco" className="server-rail-logo" width="44" height="44" />
      <span className="server-rail-divider" aria-hidden="true" />
      {servers.map((server) => {
        const active = server.id === activeServerId
        const { unread = false, mentions = 0 } = activity[server.id] || {}
        const status = mentions > 0 ? `, ${mentions} bahsedilme` : unread ? ', okunmamış mesaj var' : ''
        return (
          <button
            key={server.id}
            type="button"
            className={
              'server-rail-icon' +
              (active ? ' server-rail-icon--active' : '') +
              (unread && !active ? ' server-rail-icon--unread' : '')
            }
            title={server.name}
            aria-label={server.name + status}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(server.id)}
          >
            {serverInitials(server.name)}
            {mentions > 0 && !active && (
              <span className="mention-badge server-rail-badge" aria-hidden="true">
                {mentions > 99 ? '99+' : mentions}
              </span>
            )}
          </button>
        )
      })}
      <button
        type="button"
        className="server-rail-icon server-rail-icon--add"
        title="Sunucu oluştur ya da katıl"
        aria-label="Sunucu oluştur ya da katıl"
        onClick={onAdd}
      >
        <Plus className="icon" />
      </button>
    </nav>
  )
}
