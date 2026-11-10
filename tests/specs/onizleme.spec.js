// Bağlantı önizlemesi (2.4.0): mesajdaki ilk bağlantının başlığı, açıklaması
// ve görseli sunucuda çekilip herkese aynı kart olarak gidiyor. Sunucu iç
// ağ adreslerine (doğrudan ya da yönlendirmeyle) gitmiyor. Testte site
// yerel (127.0.0.1); düzenek sunucuya sadece buna izin veriyor.
import http from 'node:http'
import { test, expect } from '../harness/fixtures.js'
import { insertChat } from '../harness/seed.js'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

// Yerel deneme sitesi: önizlemeli sayfa, görseli, iç ağa yönlendiren adres.
async function startSite() {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    if (req.url === '/sayfa') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head>
        <title>Yedek başlık</title>
        <meta property="og:title" content="Disko gecesi &amp; karaoke">
        <meta property="og:description" content="Cuma 21.00'de pistteyiz, gelen gelsin.">
        <meta property="og:site_name" content="Kulüp">
        <meta property="og:image" content="/kapak.png">
        <meta name="theme-color" content="#9B7BFF">
      </head><body>içerik</body></html>`)
      return
    }
    if (req.url === '/kapak.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(TINY_PNG)
      return
    }
    if (req.url === '/yonlendir') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => server.close() }
}

test.describe('Bağlantı önizlemesi', { tag: '@sonra' }, () => {
  test('bağlantının kartı herkeste görünüyor; düzenleyip bağlantıyı silince kart kalkıyor', async ({ disco }) => {
    const site = await startSite()
    try {
      const mert = await disco.user('Mert')
      const ece = await disco.user('Ece')
      for (const user of [mert, ece]) await user.openChannel('genel')

      await mert.send(`bu akşam burada: ${site.base}/sayfa`)
      const message = ece.chat.locator('.chat-message', { hasText: 'bu akşam burada' })
      const card = message.locator('.link-card')
      await expect(card.locator('.link-card-title')).toHaveText('Disko gecesi & karaoke')
      await expect(card.locator('.link-card-site')).toHaveText('Kulüp')
      await expect(card.locator('.link-card-desc')).toHaveText("Cuma 21.00'de pistteyiz, gelen gelsin.")
      await expect(card.locator('.link-card-title')).toHaveAttribute('href', `${site.base}/sayfa`)
      await expect(card).toHaveAttribute('style', /--link-color: #9B7BFF/)
      // Görsel sunucudan geliyor (Ece siteye hiç bağlanmıyor).
      const image = card.locator('.link-card-media img')
      await expect(image).toHaveAttribute('src', /\/api\/link-images\/[0-9a-f]{32}$/)
      await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth)).toBe(1)
      // Site sayfayı ve görseli birer kez verdi: önizlemeyi sunucu bir kez çekti.
      expect(site.hits.filter((url) => url === '/sayfa')).toHaveLength(1)

      // Geçmişte de duruyor (yeniden girince).
      const bora = await disco.user('Bora')
      await bora.openChannel('genel')
      await expect(bora.chat.locator('.link-card-title')).toHaveText('Disko gecesi & karaoke')

      // Düzenleyip bağlantıyı silince kart herkeste kalkıyor.
      await mert.chat.locator('.chat-message', { hasText: 'bu akşam burada' }).hover()
      await mert.chat.locator('.chat-message', { hasText: 'bu akşam burada' }).getByRole('button', { name: 'Düzenle' }).click()
      const editBox = mert.chat.getByRole('textbox', { name: 'Mesajı düzenle' })
      await editBox.fill('bu akşam pistte')
      await editBox.press('Enter')
      await expect(ece.chat.locator('.chat-message', { hasText: 'bu akşam pistte' })).toBeVisible()
      await expect(ece.chat.locator('.link-card')).toHaveCount(0)
    } finally {
      site.close()
    }
  })

  test('<...> içindeki, kod içindeki ve iç ağdaki bağlantıya önizleme yok; iç ağa yönlendirme de izlenmiyor', async ({ disco }) => {
    const site = await startSite()
    try {
      const mert = await disco.client('Mert')
      await mert.joinChannel(disco.serverId, disco.channels.genel)
      const previews = []
      mert.socket.on('message-link-preview', (event) => previews.push(event))

      for (const text of [
        `önizlemesiz: <${site.base}/sayfa>`,
        `kod: \`${site.base}/sayfa\``,
        'bulut meta verisi: http://169.254.169.254/latest/meta-data/',
        'iç ağ: http://10.0.0.1/yonetim',
        `yönlendirme: ${site.base}/yonlendir`,
      ]) {
        mert.socket.emit('send-message', { text })
      }
      // Kontrol: aynı anda gönderilen düzgün bağlantı önizleniyor.
      mert.socket.emit('send-message', { text: `kontrol ${site.base}/sayfa` })
      await expect.poll(() => previews.length, { timeout: 10_000 }).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(previews).toHaveLength(1)
      expect(previews[0].linkPreview).toMatchObject({ title: 'Disko gecesi & karaoke', kind: 'page' })
      // Yönlendirme adresine gidildi ama hedefine (iç ağ) gidilmedi.
      expect(site.hits).toContain('/yonlendir')
    } finally {
      site.close()
    }
  })

  test('YouTube kartında sesteyken "Birlikte izle" var, seste değilken yok', async ({ disco }) => {
    await insertChat(disco.mongoUri, disco.channels.genel, [
      {
        username: 'Mert',
        text: 'şuna bakın https://youtu.be/aqz-KE-bpKQ',
        minutesAgo: 1,
        linkPreview: {
          url: 'https://youtu.be/aqz-KE-bpKQ',
          kind: 'youtube',
          videoId: 'aqz-KE-bpKQ',
          siteName: 'YouTube',
          title: 'Big Buck Bunny',
          description: 'Blender',
          color: '#FF0033',
        },
      },
    ])
    const ece = await disco.user('Ece')
    await ece.openChannel('genel')
    const card = ece.chat.locator('.link-card--youtube')
    await expect(card.locator('.link-card-title')).toHaveText('Big Buck Bunny')
    await expect(card.getByRole('button', { name: 'Birlikte izle' })).toHaveCount(0)
    await ece.joinVoice()
    await expect(card.getByRole('button', { name: 'Birlikte izle' })).toBeVisible()
  })
})
