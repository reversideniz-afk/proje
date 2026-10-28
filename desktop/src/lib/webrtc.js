// Ana WebRTC bağlantısının sabit kanalları (mikrofon, kamera, ekran, ekran sesi).

// Ana bağlantının (her eşle tek WebRTC bağlantısı) SABİT kanalları,
// sırasıyla: mikrofon, kamera, ekran görüntüsü, ekran sesi. Kanalları
// başlatan taraf bu sırayla ekliyor; iki taraf da aynı sırayı (mid
// sırasını) görüyor. Açıp kapamak sadece kanalın izini değiştiriyor.
export const MEDIA_ROLES = ['mic', 'camera', 'screen', 'screenAudio']

export const ROLE_KINDS = { mic: 'audio', camera: 'video', screen: 'video', screenAudio: 'audio' }

// { mic, camera, screen, screenAudio } -> kanal; kanallar henüz yoksa null.
export function transceiverRoles(pc) {
  const transceivers = pc.getTransceivers().filter((t) => t.currentDirection !== 'stopped')
  if (transceivers.length < MEDIA_ROLES.length) return null
  // Pazarlıktan sonra mid'ler "0".."3". Başlatan tarafta pazarlıktan önce
  // mid yok; o zaman ekleme sırası geçerli.
  const ordered = transceivers.every((t) => t.mid !== null)
    ? [...transceivers].sort((a, b) => Number(a.mid) - Number(b.mid))
    : transceivers
  return Object.fromEntries(MEDIA_ROLES.map((role, i) => [role, ordered[i]]))
}
