// Davet bağlantısı ve davetin kısa açıklaması.
import { SERVER_URL } from './config.js'

export function inviteLink(code) {
  return `${SERVER_URL}/davet/${code}`
}

// "30 Ekim 22:10 tarihine kadar · 2/5 kullanıldı"
export function describeInvite(invite) {
  const until = invite.expiresAt
    ? `${new Date(invite.expiresAt).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} tarihine kadar`
    : 'Süresi dolmuyor'
  const uses = invite.maxUses > 0 ? `${invite.uses}/${invite.maxUses} kullanıldı` : `${invite.uses} kez kullanıldı, sınırsız`
  return `${until} · ${uses}`
}
