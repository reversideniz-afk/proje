// @bahsetmeler: bir metnin birini bahsedip bahsetmediği (vurgulamayı
// lib/markdown.jsx yapıyor).

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Metin bu kişiyi ("@ad") ya da herkesi ("@all") bahsediyor mu: kelimenin
// tamamı, büyük/küçük harf fark etmeden ("@mertcan" Mert'i bahsetmiyor).
// Sunucudaki lib/unread.js ile aynı kural.
export function mentionsUser(text, username) {
  if (!text) return false
  const names = ['all', ...(username ? [username] : [])].map((n) => escapeRegex(n.toLocaleLowerCase('tr')))
  return new RegExp(`(^|\\s)@(${names.join('|')})($|[\\s.,!?:;)])`, 'u').test(text.toLocaleLowerCase('tr'))
}
