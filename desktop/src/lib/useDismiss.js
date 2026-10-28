// Açılır menü ve kutucukları kapatmak için: dışına tıklanınca ya da Esc'ye
// basılınca onClose çağrılıyor. ref, menünün kendisi (içine tıklamak
// kapatmıyor).
import { useEffect } from 'react'

export function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return
    const handlePointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    // Menüyü açan tıklama da "dışarıya tıklama" sayılmasın diye bir sonraki
    // turda takılıyor.
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handlePointer)
      window.addEventListener('keydown', handleKey)
    })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [ref, open, onClose])
}
