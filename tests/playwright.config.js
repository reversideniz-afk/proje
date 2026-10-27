import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  globalSetup: './harness/global-setup.js',
  // Testler aynı vekili ve sunucu sürecini paylaşıyor; sırayla çalışmalılar.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // Bilgisayarda kurulu Edge kullanılıyor, ayrıca tarayıcı indirmeye gerek yok.
    channel: process.env.DISCO_BROWSER_CHANNEL || 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: {
      args: [
        // Gerçek kamera/mikrofon yerine Chromium'un sahte cihazları: bip sesi
        // çıkaran bir mikrofon ve hareketli test görüntüsü veren bir kamera.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
})
