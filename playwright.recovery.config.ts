import { defineConfig, devices } from '@playwright/test'

const PORT = 5176

export default defineConfig({
  testDir: './e2e-recovery',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'recovery-mobile-chrome', use: { ...devices['Pixel 7'], channel: 'chrome' } }],
  webServer: {
    command: 'node e2e-recovery/artifact-server.mjs',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
