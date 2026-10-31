// Profil fotoğrafı ve sunucu simgesi: seçilen resim ortasından kare kırpılıp
// küçük bir JPEG'e çevriliyor (sunucuya küçük bir data: adresi gidiyor).
export function squareImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Resim okunamadı, tekrar dener misin?'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Resim okunamadı, tekrar dener misin?'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const scale = Math.max(size / img.width, size / img.height)
        const drawWidth = img.width * scale
        const drawHeight = img.height * scale
        canvas.getContext('2d').drawImage(img, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
