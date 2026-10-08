import { describe, expect, it, vi } from 'vitest'
import { pushEvent, resolveDefaultSyncUrl } from '../client'
import type { DeviceConnection } from '@/domain/schema'
import type { SyncEvent } from '@shared/sync-events'

describe('resolveDefaultSyncUrl', () => {
  it.each(['localhost', '127.0.0.1'])('giữ Worker cục bộ khi chạy app ở %s', (hostname) => {
    expect(resolveDefaultSyncUrl(hostname, 'https://staging.example')).toBe('http://127.0.0.1:8787')
  })

  it('bản staging dùng Worker và Durable Object tách khỏi production', () => {
    expect(
      resolveDefaultSyncUrl(
        'release-staging-260811.an-quynh.pages.dev',
        'https://my-biller-sync-staging.datshiro.workers.dev',
      ),
    ).toBe('https://my-biller-sync-staging.datshiro.workers.dev')
  })

  it('bản production giữ URL Worker production được đóng vào lúc build', () => {
    expect(
      resolveDefaultSyncUrl(
        'an-quynh.pages.dev',
        'https://my-biller-sync.datshiro.workers.dev',
      ),
    ).toBe(
      'https://my-biller-sync.datshiro.workers.dev',
    )
  })
})

describe('pushEvent', () => {
  it("gửi caps: ['item-name-taken'] để Worker biết máy xử lý được mã trùng tên", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ seq: 1, duplicate: false }), { status: 201 }),
    )
    const connection = { syncUrl: 'https://sync.example.com', shopId: 's1', token: 't'.repeat(43) } as DeviceConnection
    const event = { eventId: crypto.randomUUID() } as unknown as SyncEvent

    await pushEvent(connection, 1, event)

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.caps).toEqual(['item-name-taken'])
    fetchSpy.mockRestore()
  })
})
