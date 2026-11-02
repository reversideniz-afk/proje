// Sunucuya özel roller: geçerli renkler ve yetkiler, istemciye gönderilen
// biçim. İstemci (desktop/src/lib/roles.js) aynı listeleri gösteriyor.

const ROLE_COLORS = ["#f2726c", "#ff9f5a", "#e6b04a", "#5cc08a", "#6ea8f7", "#a98af7", "#f47fb0", "#b3a9c2"];

// manageChannels: kanal oluşturma, düzenleme, silme, erişim ayarı.
// manageMessages: başkalarının mesajlarını silme.
// kickMembers: sahip dışındaki üyeleri çıkarma, yasaklama ve susturma.
// createInvites: davet bağlantısı oluşturma ve iptal etme.
// Rolleri sadece sunucu sahibi yönetiyor (rol yetkisi yok).
const PERMISSIONS = ["manageChannels", "manageMessages", "kickMembers", "createInvites"];
const MAX_ROLES = 30;

function cleanPermissions(input) {
  return Object.fromEntries(PERMISSIONS.map((p) => [p, input?.[p] === true]));
}

// Rol adı 1-30 karakter; renk listeden ya da null.
function validateRoleInput({ name, color }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 30) return "Rol adı 1-30 karakter olmalı.";
  if (color !== null && color !== undefined && !ROLE_COLORS.includes(color)) return "Geçersiz renk.";
  return null;
}

function serializeRole(role) {
  return {
    id: role._id.toString(),
    name: role.name,
    color: role.color || null,
    hoist: !!role.hoist,
    position: role.position,
    permissions: cleanPermissions(role.permissions),
  };
}

module.exports = { ROLE_COLORS, PERMISSIONS, MAX_ROLES, cleanPermissions, validateRoleInput, serializeRole };
