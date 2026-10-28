// WebRTC için STUN/TURN sunucu bilgileri.

// YENİ (güvenlik): TURN sunucu bilgileri de koda/istemciye GÖMÜLMÜYOR —
// sadece giriş yapmış (doğrulanmış) kullanıcılara, login başarılı
// olduğunda gönderiliyor.
function buildIceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const { TURN_URL, TURN_USERNAME, TURN_CREDENTIAL } = process.env;
  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  return servers;
}

if (!process.env.TURN_URL || !process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) {
  console.warn(
    "UYARI: TURN_URL/TURN_USERNAME/TURN_CREDENTIAL ayarlanmamış — sadece STUN kullanılacak."
  );
}

module.exports = { buildIceServers };
