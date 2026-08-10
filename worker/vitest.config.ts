import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { bindings: { ADMIN_SECRET: 'test-admin-secret' } },
    }),
  ],
  test: {
    name: 'worker',
    include: ['test/**/*.test.ts'],
  },
})
