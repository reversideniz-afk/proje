// Ortak pencere (dialog): arkası karartılmış, Esc ya da arkaya tıklayınca
// kapanıyor, açılınca odak içine geçiyor ve kapanınca açan düğmeye dönüyor.
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, onClose, children, className = '', closeLabel = 'Kapat' }) {
  const dialogRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const first = dialogRef.current?.querySelector(
      '[autofocus], input, select, textarea, button:not(.dialog-close)'
    )
    ;(first || dialogRef.current)?.focus()
    return () => previouslyFocused?.focus?.()
  }, [])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <button type="button" className="icon-btn dialog-close" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
            <X className="icon" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
