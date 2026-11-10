// Ayna top ve arkadaki parıltılar. Top sürekli dönüyor (yüzeyi kayıyor) ve
// döndükçe rengi yavaşça kendi tonları arasında gidip geliyor. Hareket
// azaltma açıksa ikisi de duruyor (bkz. AynaTop.css). Hepsi sadece
// transform ve opacity ile canlanıyor (filtre yok): zayıf makinelerde de
// görüntü ve ses akışını yavaşlatmasın.
import { ballGlow, ballStripUrl, shiftHue } from '../lib/discoBall.js'
import './AynaTop.css'

export function DiscoBall({ color, size = 96, facets = 10, speed = 12, glow = true, className = '' }) {
  const glintEvery = facets >= 8 ? 13 : 7
  return (
    <span
      className={'disco-ball' + (className ? ` ${className}` : '')}
      aria-hidden="true"
      style={{
        '--ball-size': `${size}px`,
        '--ball-glow': glow ? ballGlow(color) : 'transparent',
        '--ball-speed': `${speed}s`,
        // Top yavaş döndüğü için saniyede ~10 adım gözle akıcı; her karede
        // çizmekten çok daha ucuz.
        '--ball-steps': Math.max(24, Math.round(speed * 10)),
      }}
    >
      {/* Rengin iki yanı: biri hep görünüyor, öteki 16 saniyede bir belirip
          kayboluyor (top döndükçe tonu yavaşça kayıyor). */}
      <span className="disco-ball-strip" style={{ backgroundImage: ballStripUrl(shiftHue(color, -28), facets, glintEvery) }} />
      <span
        className="disco-ball-strip disco-ball-strip--alt"
        style={{ backgroundImage: ballStripUrl(shiftHue(color, 28, 6), facets, glintEvery) }}
      />
      <span className="disco-ball-shade" />
    </span>
  )
}

// Arkadaki parıltılar: topun etrafında yavaşça dönen, yanıp sönen küçük
// elmaslar. Kartların arkasında kalıyor, sadece boşluklarda görünüyor.
// Ucuz olsun diye her parıltı ayrı bir eleman değil: iki SVG katmanı
// (yarısı bir katmanda, yarısı ötekinde) sırayla parlıyor ve ikisi birlikte
// saniyede birkaç adımla dönüyor. (Her parıltı ayrı katmanken zayıf
// makinelerde görüntü akışını geciktiriyordu.)
const GLINT_R = 760

function glintSetUrl(color, set) {
  let shapes = ''
  for (let i = set; i < 24; i += 2) {
    const angle = (i * 137.5 * Math.PI) / 180
    const dist = 170 + ((i * 97) % 580)
    const x = GLINT_R + Math.cos(angle) * dist
    const y = GLINT_R + Math.sin(angle) * dist * 0.75
    const size = i % 4 === 0 ? 9 : i % 3 === 0 ? 6 : 4
    const fill = i % 3 === 0 ? color : '#F4C152'
    shapes += `<rect x="${(x - size / 2).toFixed(1)}" y="${(y - size / 2).toFixed(1)}" width="${size}" height="${size}" rx="1.5" fill="${fill}" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLINT_R * 2} ${GLINT_R * 2}">${shapes}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export function Glints({ color = '#FF8C61', className = '' }) {
  return (
    <div className={'glints' + (className ? ` ${className}` : '')} aria-hidden="true">
      <div className="glints-spin" style={{ '--glint-r': `${GLINT_R}px` }}>
        <span className="glints-set" style={{ backgroundImage: glintSetUrl(color, 0) }} />
        <span className="glints-set glints-set--b" style={{ backgroundImage: glintSetUrl(color, 1) }} />
      </div>
    </div>
  )
}
