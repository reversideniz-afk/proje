// Güçlü gürültü bastırma (RNNoise, 2.4.0): mikrofondaki konuşma olmayan
// sesleri (fan, uğultu) yapay sinir ağıyla ayıklıyor. WASM bir AudioWorklet'te
// çalışıyor; güvenlik politikası 'wasm-unsafe-eval' izin vermezse düzenek
// testi CSP ihlalinden düşürüyor.
import { test, expect } from '../harness/fixtures.js'

async function openAudioSettings(user) {
  await user.page.getByRole('button', { name: 'Ayarlar', exact: true }).click()
  await user.page.getByRole('button', { name: 'Ses ve görüntü' }).click()
}

// Hoparlördeki sesin iki ölçümdeki en yüksek değeri.
const loudness = async (user) => Math.max(await user.speakerPeak(), await user.speakerPeak())

test.describe('Güçlü gürültü bastırma', { tag: '@sonra' }, () => {
  test('fan uğultusu gibi gürültü karşıya gitmiyor; kapatınca gidiyor, açınca yine kesiliyor', async ({ disco }) => {
    // Ses kapısı en altta: gürültüyü kapı değil, sadece RNNoise kesebilir.
    const ece = await disco.user('Ece', {
      storage: { voiceSettings: JSON.stringify({ autoSensitivity: false, thresholdDb: -80, strongNoiseSuppression: false }) },
    })
    const mert = await disco.user('Mert')
    await ece.useSyntheticNoise(-20)
    for (const user of [ece, mert]) {
      await user.openChannel('genel')
      await user.joinVoice()
    }
    await ece.micOn()

    // Kapalıyken gürültü olduğu gibi gidiyor.
    await expect.poll(() => loudness(mert), { timeout: 15_000 }).toBeGreaterThan(0.03)
    const raw = await loudness(mert)

    // Açınca mikrofon yeniden açılmadan hemen kesiliyor.
    await openAudioSettings(ece)
    const toggle = ece.page.getByRole('switch', { name: /^Güçlü gürültü bastırma/ })
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect.poll(() => loudness(mert), { timeout: 15_000 }).toBeLessThan(raw / 5)

    await toggle.click()
    await expect.poll(() => loudness(mert), { timeout: 15_000 }).toBeGreaterThan(raw / 2)
    await toggle.click()
    await expect.poll(() => loudness(mert), { timeout: 15_000 }).toBeLessThan(raw / 5)

    const saved = JSON.parse(await ece.probe(() => window.localStorage.getItem('voiceSettings')))
    expect(saved).toMatchObject({ strongNoiseSuppression: true })
    // Mikrofon izi hep aynı: ayar değişince yeniden açılmadı.
    const audioTracks = await ece.probe(() => window.__disco.mediaTracks.filter((t) => t.kind === 'audio').length)
    expect(audioTracks).toBe(1)
  })

  test('varsayılan olarak açık, ayarlarda açıklamasıyla görünüyor', async ({ disco }) => {
    const ece = await disco.user('Ece')
    await openAudioSettings(ece)
    await expect(ece.page.getByRole('switch', { name: /^Güçlü gürültü bastırma/ })).toBeChecked()
    await expect(ece.page.getByRole('switch', { name: /^Tarayıcının gürültü bastırması/ })).toBeChecked()
  })
})
