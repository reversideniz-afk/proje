// YouTube bağlantısından video kimliği (birlikte izleme için). Sunucu da
// aynı kuralla denetliyor (server/lib/linkPreview.js).
export function youtubeVideoId(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] || null
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com'

// Gömülü oynatıcının adresi: kendi düğmelerimiz var (controls=0), oynatıcı
// komutları postMessage ile alıyor (enablejsapi=1).
export function youtubeEmbedUrl(videoId) {
  const params = new URLSearchParams({
    enablejsapi: '1',
    controls: '0',
    disablekb: '1',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    modestbranding: '1',
  })
  if (/^https?:$/.test(window.location.protocol)) params.set('origin', window.location.origin)
  return `${YOUTUBE_ORIGIN}/embed/${videoId}?${params}`
}

export function formatVideoTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
