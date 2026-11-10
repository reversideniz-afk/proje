// Birlikte izleme (2.4.0): seste olan herkes aynı YouTube videosunu aynı
// anda izliyor; biri durdurunca, sarınca herkeste oluyor, sonradan gelen
// kaldığı yerden katılıyor. Testte YouTube'a gidilmiyor: gömülü oynatıcının
// adresine, aynı postMessage dilini konuşan sahte bir oynatıcı veriliyor.
import { test, expect } from '../harness/fixtures.js'

// Sahte oynatıcı: aldığı komutları window.commands'a yazıyor, gerçek
// oynatıcı gibi saniyede dört kez konum/süre/durum bildiriyor.
const FAKE_PLAYER = `<!doctype html><html><body style="margin:0;background:#123">
<script>
  let state = -1, time = 0, playing = false, last = Date.now(), listening = false
  const duration = 300
  window.commands = []
  const now = () => { if (playing) time = Math.min(duration, time + (Date.now() - last) / 1000); last = Date.now(); return time }
  const send = (event, info) => parent.postMessage(JSON.stringify({ event, info, id: 1, channel: 'widget' }), '*')
  addEventListener('message', (e) => {
    let d
    try { d = JSON.parse(e.data) } catch { return }
    if (d.event === 'listening') { if (!listening) { listening = true; send('onReady', null) } return }
    if (d.event !== 'command') return
    now()
    window.commands.push(d.func + (d.args && d.args.length ? ':' + d.args.join(',') : ''))
    if (d.func === 'playVideo') { playing = true; state = 1 }
    if (d.func === 'pauseVideo') { playing = false; state = 2 }
    if (d.func === 'seekTo') time = Number(d.args[0])
  })
  setInterval(() => { if (listening) send('infoDelivery', { currentTime: now(), duration, playerState: state }) }, 250)
</script></body></html>`

async function withFakePlayer(user) {
  await user.context.route('https://www.youtube-nocookie.com/embed/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: FAKE_PLAYER })
  )
  return user
}

// Kişinin sayfasındaki sahte oynatıcı.
const playerOf = (user) => user.page.frames().find((frame) => frame.url().startsWith('https://www.youtube-nocookie.com/embed/'))
const commandsOf = async (user) => (await playerOf(user)?.evaluate(() => window.commands)) || []
const lastSeek = async (user) => {
  const seek = (await commandsOf(user)).filter((c) => c.startsWith('seekTo:')).at(-1)
  return seek ? Number(seek.slice('seekTo:'.length).split(',')[0]) : null
}

test.describe('Birlikte izle', { tag: '@sonra' }, () => {
  test('başlatan, durduran, saran herkeste; sonradan gelen kaldığı yerden; bitirince herkeste kapanıyor', async ({ disco }) => {
    const mert = await withFakePlayer(await disco.user('Mert'))
    const ece = await withFakePlayer(await disco.user('Ece'))
    for (const user of [mert, ece]) {
      await user.openChannel('genel')
      await user.joinVoice()
    }

    // Bağlantı penceresi: YouTube olmayan bağlantı kabul edilmiyor.
    await mert.voicePanel().getByRole('button', { name: 'Birlikte izle' }).click()
    const dialog = mert.page.getByRole('dialog', { name: 'Birlikte izle' })
    await dialog.getByLabel('YouTube bağlantısı').fill('https://ornek.invalid/video')
    await expect(dialog.getByText('Bu bir YouTube video bağlantısı değil.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Başlat' })).toBeDisabled()
    await dialog.getByLabel('YouTube bağlantısı').fill('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=5')
    await dialog.getByRole('button', { name: 'Başlat' }).click()
    await expect(dialog).toHaveCount(0)

    // İkisinde de oynuyor ve süre görünüyor.
    for (const user of [mert, ece]) {
      const panel = user.page.getByRole('region', { name: 'Birlikte izle' })
      await expect(panel).toBeVisible()
      await expect(panel.locator('.watch-time')).toContainText('/ 5:00')
      await expect.poll(() => commandsOf(user)).toContain('playVideo')
    }
    await expect(ece.page.locator('.watch-note')).toHaveText(' · Mert başlattı')

    // Ece duraklatıyor: Mert'te de duruyor.
    await ece.page.getByRole('region', { name: 'Birlikte izle' }).getByRole('button', { name: 'Duraklat', exact: true }).click()
    await expect.poll(() => commandsOf(mert)).toContain('pauseVideo')
    await expect(mert.page.locator('.watch-note')).toHaveText(' · Ece duraklattı')
    await expect(mert.page.getByRole('region', { name: 'Birlikte izle' }).getByRole('button', { name: 'Oynat', exact: true })).toBeVisible()

    // Mert sarıyor (kaydırıcıda Page Up = %10 ileri): Ece'nin oynatıcısı da oraya gidiyor.
    const seek = mert.page.getByRole('slider', { name: 'Videoda konum' })
    await seek.focus()
    await seek.press('PageUp')
    await expect(mert.page.locator('.watch-note')).toHaveText(' · Mert ileri/geri sardı')
    await expect.poll(() => lastSeek(ece)).toBeGreaterThan(25)
    const seekedTo = await lastSeek(ece)

    // Sonradan gelen Bora duraklatılmış videoyu aynı yerde görüyor.
    const bora = await withFakePlayer(await disco.user('Bora'))
    await bora.openChannel('genel')
    await bora.joinVoice()
    const boraPanel = bora.page.getByRole('region', { name: 'Birlikte izle' })
    await expect(boraPanel).toBeVisible()
    await expect(boraPanel.getByRole('button', { name: 'Oynat', exact: true })).toBeVisible()
    await expect.poll(async () => (await commandsOf(bora)).includes('pauseVideo')).toBe(true)
    await expect.poll(() => lastSeek(bora)).toBeCloseTo(seekedTo, 0)

    // Mert bitiriyor: herkeste kapanıyor.
    await mert.page.getByRole('button', { name: 'Birlikte izlemeyi bitir' }).click()
    for (const user of [mert, ece, bora]) {
      await expect(user.page.getByRole('region', { name: 'Birlikte izle' })).toHaveCount(0)
    }
  })

  test('sunucu: seste olmayan başlatamıyor, geçersiz video reddediliyor, oda boşalınca oturum bitiyor', async ({ disco }) => {
    const mert = await disco.client('Mert')
    await mert.joinChannel(disco.serverId, disco.channels.genel)
    expect(await mert.emitAck('watch-start', { videoId: 'aqz-KE-bpKQ' })).toEqual({ success: false, message: 'Önce sese katıl.' })

    expect(await mert.emitAck('join-voice', { channelId: disco.channels.genel, state: {} })).toMatchObject({ success: true })
    expect(await mert.emitAck('watch-start', { videoId: '../../etc' })).toEqual({
      success: false,
      message: 'Geçerli bir YouTube bağlantısı değil.',
    })
    const started = mert.nextEvent('watch-state')
    expect(await mert.emitAck('watch-start', { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny' })).toEqual({ success: true })
    expect(await started).toMatchObject({
      session: { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny', startedBy: 'Mert', playing: true, position: 0 },
      by: 'Mert',
      action: 'start',
    })
    expect(await mert.emitAck('watch-control', { action: 'seek' })).toEqual({ success: false, message: 'Geçersiz konum.' })
    const paused = mert.nextEvent('watch-state')
    await mert.emitAck('watch-control', { action: 'pause', position: 42 })
    expect(await paused).toMatchObject({ session: { playing: false, position: 42 }, action: 'pause' })

    // Herkes çıkınca oturum bitiyor: yeniden girene video gelmiyor.
    mert.socket.emit('leave-voice')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const ece = await disco.client('Ece')
    await ece.joinChannel(disco.serverId, disco.channels.genel)
    let gotState = false
    ece.socket.on('watch-state', () => {
      gotState = true
    })
    expect(await ece.emitAck('join-voice', { channelId: disco.channels.genel, state: {} })).toMatchObject({ success: true })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(gotState).toBe(false)
  })
})
