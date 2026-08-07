import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' chứ không phải 'autoUpdate': tự reload giữa lúc đang lên đơn là mất đơn
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'my-biller — Bán hàng',
        short_name: 'Biller',
        description: 'Bán hàng, xuất phiếu, theo dõi doanh thu và công nợ. Chạy offline.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FFFFFF',
        theme_color: '#0B7A42',
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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    // Ranh giới ngày/tháng của app tính theo giờ địa phương người bán. Chạy test ở múi giờ khác thì
    // mấy ca 23:50 / 00:10 vẫn xanh mà chẳng chứng minh được gì.
    env: { TZ: 'Asia/Ho_Chi_Minh' },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: { include: ['src/domain/**'], reporter: ['text', 'html'] },
  },
})
