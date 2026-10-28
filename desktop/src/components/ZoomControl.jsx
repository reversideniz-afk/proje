// Ayarlar > Görünüm'deki yakınlaştırma kontrolü (sadece masaüstünde).
import { Expand, Minus, Plus, Shrink } from 'lucide-react'

// Ctrl+/Ctrl- ile aynı işi yapar. Eskiden her ekranın köşesinde sabit
// duruyordu ve dar ekranda "Gönder" düğmesini kapatıyordu (H13).
export function ZoomControl({ zoomLevel, onZoomOut, onZoomIn, onReset, isFullscreen, onToggleFullscreen }) {
  return (
    <div className="zoom-control">
      <div className="zoom-control-stepper">
        <button type="button" className="icon-btn" onClick={onZoomOut} title="Küçült (Ctrl -)" aria-label="Küçült">
          <Minus className="icon" />
        </button>
        <button type="button" className="zoom-control-value" onClick={onReset} title="Sıfırla (Ctrl 0)">
          {Math.round(zoomLevel * 100)}%
        </button>
        <button type="button" className="icon-btn" onClick={onZoomIn} title="Büyüt (Ctrl +)" aria-label="Büyüt">
          <Plus className="icon" />
        </button>
      </div>
      {onToggleFullscreen && (
        <button type="button" className="btn btn--secondary" onClick={onToggleFullscreen}>
          {isFullscreen ? <Shrink className="icon" /> : <Expand className="icon" />}
          {isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
        </button>
      )}
    </div>
  )
}
