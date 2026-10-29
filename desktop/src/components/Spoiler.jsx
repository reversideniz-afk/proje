// Mesajdaki ||spoiler||: tıklayana (ya da Enter'a basana) kadar kapalı.
import { useState } from 'react'

export function Spoiler({ children }) {
  const [shown, setShown] = useState(false)
  if (shown) return <span className="md-spoiler md-spoiler--shown">{children}</span>
  return (
    <span
      className="md-spoiler"
      role="button"
      tabIndex={0}
      aria-label="Spoiler, göstermek için tıkla"
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setShown(true)
        }
      }}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  )
}
