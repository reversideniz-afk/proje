// Tarayıcıdaki bir kullanıcıyı arayüz üzerinden yöneten yardımcı: tıpkı
// gerçek bir kullanıcı gibi giriş yapar, kanala girer, sese katılır.
import { expect } from '@playwright/test'
import {
  readIncomingAudioBytes,
  readIncomingAudioBytesPerConnection,
  readSpeakerPeak,
} from './instrument.js'
import { PASSWORD } from './seed.js'

export class UserSession {
  constructor(name, context, page) {
    this.name = name
    this.context = context
    this.page = page
    this.chat = page.locator('.chat-messages')
  }

  async login({ rememberMe = false } = {}) {
    const { page } = this
    await page.getByLabel('Kullanıcı adı').fill(this.name)
    await page.getByLabel('Şifre', { exact: true }).fill(PASSWORD)
    if (rememberMe) await page.getByLabel('Beni hatırla').check()
    // Masaüstü uygulamasında (Electron) açılıştan hemen sonra gönderilen
    // tıklama test düzeneğinde arada bir pencereye ulaşmıyor: alanlar dolu,
    // uygulama değerleri görmüş, ama düğmeye hiçbir şey varmıyor (odak
    // şifrede kalıyor). Form gitmediyse, ilk tıklaması tutmayan bir
    // kullanıcı gibi tekrar tıklıyoruz.
    const submitted = page.locator('.whoami').or(page.getByRole('button', { name: 'Giriş yapılıyor…' }))
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.getByRole('button', { name: 'Giriş yap', exact: true }).click()
      const sent = await submitted.first().waitFor({ timeout: 2000 }).then(() => true, () => false)
      if (sent) break
    }
    await expect(page.locator('.whoami')).toContainText(this.name)
  }

  channelButton(channelName) {
    return this.page.locator('.channel-list .channel-button', {
      has: this.page.locator('.channel-name', { hasText: new RegExp(`^${channelName}$`) }),
    })
  }

  // Ana alanın başlığındaki kanal adı.
  channelTitle() {
    return this.page.locator('.channel-header-title')
  }

  // Sol alttaki "Ses bağlı" paneli: seste olduğun sürece hangi kanala
  // bakarsan bak görünüyor.
  voicePanel() {
    return this.page.getByRole('region', { name: 'Ses bağlantısı' })
  }

  async openChannel(channelName) {
    await this.channelButton(channelName).click()
    await expect(this.channelTitle()).toHaveText(channelName)
    // Sunucu kanala katıldığımızı onaylayınca kendimizi çevrimiçi listesinde görürüz.
    await expect(this.page.locator('.member-item--online', { hasText: this.name })).toBeVisible()
  }

  async joinVoice() {
    await this.page.getByRole('button', { name: 'Sese katıl', exact: true }).click()
    await expect(this.leaveVoiceButton()).toBeVisible()
  }

  leaveVoiceButton() {
    return this.voicePanel().getByRole('button', { name: 'Sesten çık' })
  }

  mediaButton(title) {
    return this.page.locator('.media-controls').getByTitle(title, { exact: true })
  }

  async micOn() {
    await this.mediaButton('Mikrofonu aç').click()
    await expect(this.mediaButton('Mikrofonu kapat')).toBeVisible()
  }

  async cameraOn() {
    await this.mediaButton('Kamerayı aç').click()
    await expect(this.mediaButton('Kamerayı kapat')).toBeVisible()
  }

  async send(text) {
    await this.page.getByLabel('Mesaj yaz').fill(text)
    await this.page.getByRole('button', { name: 'Gönder' }).click()
  }

  peerTile(peerName) {
    return this.page.locator('.remote-video-wrapper', {
      has: this.page.locator('.remote-video-label', { hasText: new RegExp(`^${peerName}$`) }),
    })
  }

  // Ağ katmanı: karşıdan ses paketleri geliyor mu?
  async expectAudioPacketsArriving({ timeout = 15_000 } = {}) {
    const before = await this.page.evaluate(readIncomingAudioBytes)
    await expect
      .poll(async () => (await this.page.evaluate(readIncomingAudioBytes)) - before, {
        message: `${this.name} karşı taraftan ses paketi almıyor`,
        timeout,
      })
      .toBeGreaterThan(0)
  }

  // Seste N kişi daha varsa: N ayrı bağlantının HER BİRİNDEN ses geliyor mu?
  async expectAudioFromEachPeer(peerCount, { timeout = 15_000 } = {}) {
    const before = await this.page.evaluate(readIncomingAudioBytesPerConnection)
    await expect
      .poll(
        async () => {
          const now = await this.page.evaluate(readIncomingAudioBytesPerConnection)
          if (now.length !== before.length) return `bağlantı sayısı değişti: ${now.length}`
          return now.filter((bytes, i) => bytes > before[i]).length
        },
        { message: `${this.name} her eşten ses almıyor`, timeout }
      )
      .toBe(peerCount)
    expect(before).toHaveLength(peerCount)
  }

  speakerPeak() {
    return this.page.evaluate(readSpeakerPeak)
  }

  // Kullanıcı katmanı: hoparlörden gerçekten ses çıkıyor mu? Kısa efekt
  // seslerini (katılma/mesaj tıkı) saymamak için art arda iki ölçüm
  // penceresinde de ses olmalı.
  async expectHearingSomeone({ timeout = 15_000 } = {}) {
    await expect
      .poll(
        async () => {
          const first = await this.speakerPeak()
          const second = await this.speakerPeak()
          return Math.min(first, second)
        },
        { message: `${this.name} hoparlöründen ses gelmiyor`, timeout }
      )
      .toBeGreaterThan(0.01)
  }

  // Sayfadaki gözlem kaydından (bkz. instrument.js) bir değer okur.
  probe(fn) {
    return this.page.evaluate(fn)
  }
}
