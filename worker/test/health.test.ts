import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('GET /health', () => {
  it('returns the Worker health status', async () => {
    const response = await SELF.fetch('https://example.com/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('returns 404 for unknown routes', async () => {
    const response = await SELF.fetch('https://example.com/unknown')

    expect(response.status).toBe(404)
  })
})
