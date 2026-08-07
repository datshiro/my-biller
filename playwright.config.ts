import { defineConfig, devices } from '@playwright/test'

/**
 * Cổng 5174 để không giành cổng với `npm run dev` (5173) đang mở trong lúc làm việc.
 * Chạy ở chế độ dev vì e2e cần nút "Nạp dữ liệu mẫu" — nút này chỉ có trong bản dev.
 */
const PORT = 5174

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  /**
   * Chrome thật của máy (`channel`), không phải bản chromium đóng gói kèm: phiếu được chụp bằng
   * canvas và in bằng engine của trình duyệt, nên nên kiểm trên đúng thứ người bán sẽ chạy.
   * Máy chưa có thì `npx playwright install chrome`.
   */
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'], channel: 'chrome' } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
