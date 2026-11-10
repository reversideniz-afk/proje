// Bağlantı önizlemesi: mesajdaki ilk bağlantının başlığı, açıklaması ve
// görseli sunucuda bir kez çekilip mesaja ekleniyor; herkes aynı kartı
// görüyor ve istemciler o siteye hiç bağlanmıyor (IP adresleri gitmiyor).
//
// GÜVENLİK (SSRF): sunucu, kullanıcının yazdığı adrese istek atıyor. Bu
// yüzden sadece http/https, sadece 80/443, adres DNS'te çözülüp HER adresin
// herkese açık internette olduğu denetleniyor ve bağlantı o denetlenen
// adrese sabitleniyor (DNS sonradan iç ağa dönse de gidilmiyor). Her
// yönlendirme aynı denetimden geçiyor; boyut ve süre sınırlı.
const crypto = require("crypto");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const zlib = require("zlib");

const TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 600 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const USER_AGENT = "Mozilla/5.0 (compatible; DiscoLinkPreview/1.0)";

// Herkese açık olmayan adresler: iç ağlar, makinenin kendisi, bulut
// meta-veri adresi (169.254.169.254), çoklu yayın, ayrılmış bloklar.
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

// SADECE TEST: yerel test sitesine (127.0.0.1) izin. ALLOW_TEST_TOKENS ile
// birlikte olmadan hiçbir işe yaramıyor; ikisi de Render'da asla ayarlanmıyor.
function loopbackAllowed() {
  return process.env.ALLOW_TEST_TOKENS === "true" && process.env.LINK_PREVIEW_ALLOW_LOOPBACK === "true";
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  // ::ffff:10.0.0.1 gibi IPv6 içine gömülü IPv4 adresleri de denetleniyor.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  if (loopbackAllowed() && (address === "127.0.0.1" || address === "::1")) return true;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function resolvePublic(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
    throw new Error("iç ağ adresi");
  }
  return addresses[0];
}

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("geçersiz adres");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("sadece http/https");
  if (url.username || url.password) throw new Error("kullanıcı bilgili adres");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const testPort = loopbackAllowed() && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (!["80", "443"].includes(port) && !testPort) throw new Error("izin verilmeyen port");
  return url;
}

// Tek istek: denetlenmiş adrese sabitlenmiş, süre ve boyut sınırlı.
function requestOnce(url, address, { maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Language": "tr,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
        // DNS'i yeniden sormadan denetlenen adrese bağlan.
        lookup: (_hostname, options, callback) => {
          if (options && options.all) callback(null, [{ address: address.address, family: address.family }]);
          else callback(null, address.address, address.family);
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let stream = res;
        const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
        if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const finish = (truncated) =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated });
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          finish(false);
          return;
        }
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            req.destroy();
            finish(true);
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => finish(false));
        stream.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("zaman aşımı")));
    req.on("error", reject);
    req.end();
  });
}

async function safeFetch(raw, { maxBytes, accept }) {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const address = await resolvePublic(url.hostname);
    const res = await requestOnce(url, address, { maxBytes, accept });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = checkUrl(new URL(res.headers.location, url).href);
      continue;
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return { ...res, url };
  }
  throw new Error("çok fazla yönlendirme");
}

// ---- HTML'den başlık, açıklama, görsel ----

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const clean = (text, max) => {
  if (!text) return null;
  const value = decodeEntities(String(text)).replace(/\s+/g, " ").trim();
  if (!value) return null;
  return value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
};

function parseAttributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

function decodeBody(body, contentType) {
  const charset = /charset=([\w-]+)/i.exec(contentType || "")?.[1]?.toLowerCase();
  let text = body.toString("utf8");
  const declared = charset || /<meta[^>]+charset=["']?([\w-]+)/i.exec(text)?.[1]?.toLowerCase();
  if (declared && !["utf-8", "utf8"].includes(declared)) {
    try {
      text = new TextDecoder(declared).decode(body);
    } catch {
      // Bilinmeyen kodlama: UTF-8 olarak kalıyor.
    }
  }
  return text;
}

function parseHtml(html, pageUrl) {
  const head = html.slice(0, MAX_HTML_BYTES);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = clean(meta["og:title"] || meta["twitter:title"] || titleTag, 200);
  const description = clean(meta["og:description"] || meta["twitter:description"] || meta.description, 300);
  const siteName = clean(meta["og:site_name"], 80) || pageUrl.hostname.replace(/^www\./, "");
  let image = meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"] || meta["twitter:image:src"];
  try {
    image = image ? new URL(decodeEntities(image), pageUrl).href : null;
  } catch {
    image = null;
  }
  const color = /^#[0-9a-f]{6}$/i.test(meta["theme-color"] || "") ? meta["theme-color"] : null;
  return { title, description, siteName, image, color };
}

// ---- Mesajdaki bağlantı ----

// Kod bloklarının, satır içi kodun, spoiler'ın ve <...> içine alınmış
// (önizleme istemiyorum) bağlantıların dışındaki ilk http(s) adresi.
function firstLinkIn(text) {
  const visible = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\|\|[\s\S]*?\|\|/g, " ")
    .replace(/<https?:\/\/[^\s>]+>/gi, " ");
  const match = /https?:\/\/[^\s<>"'`]+/i.exec(visible);
  if (!match) return null;
  // Cümle sonundaki noktalama bağlantıya dahil değil; kapanmamış parantez de.
  let link = match[0].replace(/[.,;:!?]+$/, "");
  if (link.endsWith(")") && (link.match(/\(/g) || []).length < (link.match(/\)/g) || []).length) link = link.slice(0, -1);
  return link.length <= 2000 ? link : null;
}

function youtubeVideoId(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] || null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// ---- Görseller (sunucudan /api/link-images/:id ile gidiyor) ----

async function fetchImage(raw, LinkImage) {
  const id = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  if (await LinkImage.exists({ _id: id })) return id;
  const res = await safeFetch(raw, { maxBytes: MAX_IMAGE_BYTES + 1, accept: "image/*" });
  if (res.truncated) throw new Error("görsel çok büyük");
  const type = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) throw new Error("görsel değil");
  const data = `data:${type};base64,${res.body.toString("base64")}`;
  await LinkImage.updateOne({ _id: id }, { $setOnInsert: { data, createdAt: new Date() } }, { upsert: true });
  return id;
}

// ---- Önizleme ----

const cache = new Map(); // adres -> { at, preview }
const CACHE_MS = 60 * 60 * 1000;
const FAIL_CACHE_MS = 10 * 60 * 1000;
let running = 0;
const MAX_RUNNING = 4;

async function buildPreview(link, LinkImage) {
  const videoId = youtubeVideoId(link);
  if (videoId) {
    // YouTube sayfası botlara çerez onayı gösterebiliyor: oEmbed daha sağlam.
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, {
      maxBytes: 64 * 1024,
      accept: "application/json",
    });
    const data = JSON.parse(res.body.toString("utf8"));
    let imageId = null;
    try {
      imageId = await fetchImage(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, LinkImage);
    } catch {
      // Görselsiz de olur.
    }
    return {
      url: link,
      kind: "youtube",
      videoId,
      siteName: "YouTube",
      title: clean(data.title, 200),
      description: clean(data.author_name, 120),
      imageId,
      color: "#FF0033",
    };
  }
  const res = await safeFetch(link, { maxBytes: MAX_HTML_BYTES, accept: "text/html,application/xhtml+xml" });
  const type = String(res.headers["content-type"] || "").toLowerCase();
  if (type.startsWith("image/")) {
    // Doğrudan görsel bağlantısı: kart sadece görsel.
    const imageId = await fetchImage(res.url.href, LinkImage);
    return { url: link, kind: "image", siteName: res.url.hostname.replace(/^www\./, ""), title: null, description: null, imageId };
  }
  if (!type.includes("html")) return null;
  const meta = parseHtml(decodeBody(res.body, type), res.url);
  if (!meta.title && !meta.description) return null;
  let imageId = null;
  if (meta.image) {
    try {
      imageId = await fetchImage(meta.image, LinkImage);
    } catch {
      // Görsel çekilemezse kart görselsiz.
    }
  }
  return {
    url: link,
    kind: "page",
    siteName: meta.siteName,
    title: meta.title,
    description: meta.description,
    imageId,
    color: meta.color,
  };
}

// null: önizleme yok (bağlantı yok, site izin vermiyor, iç ağ…).
async function previewFor(link, LinkImage) {
  const cached = cache.get(link);
  if (cached && Date.now() - cached.at < (cached.preview ? CACHE_MS : FAIL_CACHE_MS)) return cached.preview;
  // Aynı anda çok fazla istek varsa bu sefer önizlemesiz (önbelleğe
  // yazılmıyor; bir sonraki mesajda yeniden deneniyor).
  if (running >= MAX_RUNNING) return null;
  running++;
  let preview = null;
  try {
    preview = await buildPreview(link, LinkImage);
  } catch {
    preview = null;
  } finally {
    running--;
  }
  cache.set(link, { at: Date.now(), preview });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return preview;
}

function serializePreview(preview) {
  if (!preview) return null;
  return {
    url: preview.url,
    kind: preview.kind,
    videoId: preview.videoId || null,
    siteName: preview.siteName || null,
    title: preview.title || null,
    description: preview.description || null,
    imageUrl: preview.imageId ? `/api/link-images/${preview.imageId}` : null,
    color: preview.color || null,
  };
}

module.exports = { firstLinkIn, youtubeVideoId, previewFor, serializePreview, isPublicAddress, checkUrl };
