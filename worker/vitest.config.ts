import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ADMIN_SECRET: 'test-admin-secret',
          ADMIN_VIEW_SECRET: 'test-admin-view-secret-0123456789abcdef',
        },
      },
    }),
  ],
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
  },
})
