// Kişinin avatarı: profil fotoğrafı ya da kişiye özel renkte baş harfi.
// İsteğe bağlı çevrimiçi noktası ve konuşurken Spot ışığı.
import { SERVER_URL } from '../lib/config.js'
import { initialOf, userColor } from '../lib/userColor.js'

// Sunucu avatarları adresle veriyor ("/api/avatars/..."); eski oturumdan
// kalmış data: adresleri de olduğu gibi çalışıyor.
function avatarSrc(url) {
  if (!url) return null
  return url.startsWith('/') ? `${SERVER_URL}${url}` : url
}

export function Avatar({ name, src, size = 'md', status, speaking = false, className = '' }) {
  const image = avatarSrc(src)
  return (
    <span
      className={`avatar avatar--${size}${speaking ? ' is-speaking' : ''} ${className}`}
      style={{ '--c': userColor(name) }}
      aria-hidden="true"
    >
      {image ? <img src={image} alt="" draggable="false" /> : initialOf(name)}
      {status && <i className={`status-dot status-dot--${status}`} />}
    </span>
  )
}
