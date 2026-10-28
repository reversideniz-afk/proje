// Ayarlar > Kişiselleştirme'deki yakınlaştırma kontrolü (sadece masaüstünde).

// Ayarlar > Kişiselleştirme'deki yakınlaştırma kontrolü — Ctrl+/Ctrl- ile
// aynı işi yapar. Eskiden her ekranın köşesinde sabit duruyordu ve dar
// ekranda "Gönder" düğmesini kapatıyordu (H13).
export function ZoomControl({ zoomLevel, onZoomOut, onZoomIn, onReset, isFullscreen, onToggleFullscreen }) {
  return (
    <div className="zoom-control">
      <button onClick={onZoomOut} title="Küçült (Ctrl -)">
        −
      </button>
      <span onClick={onReset} title="Sıfırla (Ctrl 0)">
        {Math.round(zoomLevel * 100)}%
      </span>
      <button onClick={onZoomIn} title="Büyüt (Ctrl +)">
        +
      </button>
      {/* YENİ: tek tuşla çerçevesiz tam ekran. */}
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran yap'}
        >
          {isFullscreen ? '⤢' : '⛶'}
        </button>
      )}
    </div>
  )
}
