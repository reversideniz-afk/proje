// En soldaki sunucu şeridi: her sunucu bir simge, en altta "sunucu ekle".
import { Plus } from 'lucide-react'
import logoUrl from '../assets/logo.png'

// "Oyun Gecesi" -> "OG", "Disco" -> "DI"
function serverInitials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.trim().slice(0, 2)
  return letters.toLocaleUpperCase('tr')
}

export function ServerRail({ servers, activeServerId, onSelect, onAdd }) {
  return (
    <nav className="server-rail" aria-label="Sunucular">
      <img src={logoUrl} alt="Disco" className="server-rail-logo" width="44" height="44" />
      <span className="server-rail-divider" aria-hidden="true" />
      {servers.map((server) => {
        const active = server.id === activeServerId
        return (
          <button
            key={server.id}
            type="button"
            className={'server-rail-icon' + (active ? ' server-rail-icon--active' : '')}
            title={server.name}
            aria-label={server.name}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect(server.id)}
          >
            {serverInitials(server.name)}
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
