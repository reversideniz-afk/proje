// Kişiye özel renk: aynı ad her cihazda aynı rengi alıyor. Renklerin hepsi
// koyu zeminde yazı olarak en az 4,5:1 kontrast veriyor; avatarın içindeki
// baş harf ise koyu (Gece) renkte yazılıyor.
const USER_COLORS = [
  '#c9a7ff', // leylak
  '#7fd8f0', // gökyüzü
  '#ffc27a', // kayısı
  '#f59acb', // pembe
  '#8ee3a5', // nane
  '#e6d36a', // kum
  '#9db4ff', // lavanta mavisi
  '#ff9f8a', // somon
]

export function userColor(username = '') {
  let hash = 0
  for (const char of username.toLocaleLowerCase('tr')) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0
  }
  return USER_COLORS[hash % USER_COLORS.length]
}

export function initialOf(username = '') {
  return username.charAt(0).toLocaleUpperCase('tr') || '?'
}
