import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const jsonHeaders = { 'content-type': 'application/json' }

describe('WebSocket đồng bộ', () => {
  it('giữ WebSocket khi gateway chuyển tiếp response 101 từ Durable Object', async () => {
    const created = await SELF.fetch('https://example.com/shop', {
      method: 'POST',
      headers: { ...jsonHeaders, authorization: 'Bearer test-admin-secret' },
    })
    expect(created.status).toBe(201)
    const shop = await created.json<{ shopId: string; code: string }>()

    const paired = await SELF.fetch('https://example.com/pair', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        code: shop.code,
        letter: 'A',
        label: 'Quầy trước',
        hasLocalLedger: false,
        localLedgerRows: 0,
      }),
    })
    expect(paired.status).toBe(201)
    const device = await paired.json<{ token: string }>()

    const activated = await SELF.fetch(`https://example.com/shop/${shop.shopId}/seed`, {
      method: 'POST',
      headers: { ...jsonHeaders, authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ events: [] }),
    })
    expect(activated.status).toBe(201)

    const upgraded = await SELF.fetch(`https://example.com/shop/${shop.shopId}/ws`, {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': `my-biller, ${device.token}`,
      },
    })

    expect(upgraded.status).toBe(101)
    const socket = (upgraded as Response & { webSocket: WebSocket | null }).webSocket
    expect(socket).toBeInstanceOf(WebSocket)
    socket?.accept()
    socket?.close(1000, 'test complete')
  })
})
