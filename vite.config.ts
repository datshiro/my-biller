import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ command, mode }) => ({
  define: {
    __MY_BILLER_ENABLE_TEST_DATA__: JSON.stringify(command === 'serve' || mode === 'staging'),
    __MY_BILLER_RECOVERY_MODE__: JSON.stringify(mode === 'recovery'),
    __MY_BILLER_REMOTE_SYNC_URL__: JSON.stringify(
      mode === 'staging'
        ? 'https://my-biller-sync-staging.datshiro.workers.dev'
        : 'https://my-biller-sync.datshiro.workers.dev',
    ),
  },
  build: {
    outDir: mode === 'recovery' ? 'dist-recovery' : 'dist',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  plugins: [
    {
      name: 'my-biller-app-mode-title',
      transformIndexHtml: (html) =>
        mode === 'recovery'
          ? html.replace(
              '<title>my-biller — Bán hàng</title>',
              '<title>my-biller — Phục hồi chỉ đọc</title>',
            ).replace(
              '<meta name="theme-color" content="#0B7A42" />',
              '<meta name="theme-color" content="#C0271A" />',
            ).replace(
              'Bán hàng, xuất phiếu, theo dõi doanh thu và công nợ. Chạy offline.',
              'Chỉ đọc dữ liệu cục bộ và tải file sao lưu khi có sự cố.',
            )
          : html,
    },
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' chứ không phải 'autoUpdate': tự reload giữa lúc đang lên đơn là mất đơn
      registerType: mode === 'recovery' ? 'autoUpdate' : 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: mode === 'recovery' ? 'my-biller — Phục hồi' : 'my-biller — Bán hàng',
        short_name: mode === 'recovery' ? 'Biller cứu dữ liệu' : 'Biller',
        description:
          mode === 'recovery'
            ? 'Chỉ đọc dữ liệu cục bộ và tải file sao lưu khi có sự cố.'
            : 'Bán hàng, xuất phiếu, theo dõi doanh thu và công nợ. Chạy offline.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFFFFF',
        theme_color: mode === 'recovery' ? '#C0271A' : '#0B7A42',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        skipWaiting: mode === 'recovery',
        clientsClaim: mode === 'recovery',
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'node',
          // Ranh giới ngày/tháng của app tính theo giờ địa phương người bán. Chạy test ở múi giờ khác
          // thì mấy ca 23:50 / 00:10 vẫn xanh mà chẳng chứng minh được gì.
          env: { TZ: 'Asia/Ho_Chi_Minh' },
          setupFiles: ['./src/test-setup.ts'],
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
      './worker/vitest.config.ts',
    ],
    // `src/db` cũng phải nằm trong tầm đo: đó là lớp duy nhất thật sự ghi tiền (transaction, recalc,
    // sao lưu). Không đo thì không biết nhánh nào chưa ai chạy qua.
    coverage: { include: ['src/domain/**', 'src/db/**'], reporter: ['text', 'html'] },
  },
}))
