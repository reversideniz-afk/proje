// Kişinin avatarı: profil fotoğrafı ya da kişiye özel renkte baş harfi.
// İsteğe bağlı çevrimiçi noktası ve konuşurken Spot ışığı.
import { assetUrl } from '../lib/config.js'
import { initialOf, userColor } from '../lib/userColor.js'

export function Avatar({ name, src, size = 'md', status, speaking = false, className = '' }) {
  const image = assetUrl(src)
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
