// Sunucuya özel roller: renkler, yetkiler ve bir kişinin görünen rengi.
// Sunucu (server/lib/roles.js) aynı renk ve yetki listesini doğruluyor.

// Gece zeminde okunan renkler; Spot ışığı (konuşuyor) bilerek yok.
export const ROLE_COLORS = ['#f2726c', '#ff9f5a', '#e6b04a', '#5cc08a', '#6ea8f7', '#a98af7', '#f47fb0', '#b3a9c2']

export const PERMISSIONS = [
  { id: 'manageChannels', label: 'Kanalları yönet', hint: 'Kanal oluşturur, adını değiştirir, siler ve kimlerin göreceğini ayarlar.' },
  { id: 'manageMessages', label: 'Mesajları yönet', hint: 'Başkalarının mesajlarını siler.' },
  { id: 'kickMembers', label: 'Üyeleri yönet', hint: 'Sunucu sahibi dışında üyeleri çıkarır, yasaklar ve susturur.' },
  { id: 'createInvites', label: 'Davet oluştur', hint: 'Davet bağlantısı oluşturur ve iptal eder.' },
]

// Kişinin rollerinden en üsttekinin rengi (renksiz roller atlanıyor).
export function roleColorOf(roleIds, roles) {
  if (!roleIds?.length) return null
  return roles.find((role) => role.color && roleIds.includes(role.id))?.color ?? null
}

// Üye listesinde ayrı gösterilen en üstteki rolü.
export function hoistedRoleOf(roleIds, roles) {
  if (!roleIds?.length) return null
  return roles.find((role) => role.hoist && roleIds.includes(role.id)) ?? null
}
