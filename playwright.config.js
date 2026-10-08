const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    acceptDownloads: true,
    serviceWorkers: 'block',
    // Traces are disabled because this macOS 12 host can launch the system
    // Chrome channel but cannot reliably retain Playwright trace artifacts.
    trace: 'off'
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    timeout: 10_000
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } }
  ]
});
