import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairDevice, pushEvent, resolveDefaultSyncUrl } from '../client'
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

const LOCAL_URL = 'http://127.0.0.1:8787'
const REMOTE_URL = 'https://my-biller-sync.datshiro.workers.dev'
const INSTALL_ID = '6f1c9d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f'

describe('resolveDefaultSyncUrl với cờ native', () => {
  it.each([
    {
      name: 'localhost không phải native (web hoặc APK chạy DEV) giữ Worker cục bộ',
      hostname: 'localhost',
      native: false,
      expected: LOCAL_URL,
    },
    {
      name: 'APK bản dựng gọi Worker remote dù hostname là localhost',
      hostname: 'localhost',
      native: true,
      expected: REMOTE_URL,
    },
    {
      name: 'máy web trên Pages gọi Worker remote',
      hostname: 'an-quynh.pages.dev',
      native: false,
      expected: REMOTE_URL,
    },
    {
      name: '127.0.0.1 không phải native giữ Worker cục bộ',
      hostname: '127.0.0.1',
      native: false,
      expected: LOCAL_URL,
    },
  ])('$name', ({ hostname, native, expected }) => {
    expect(resolveDefaultSyncUrl(hostname, REMOTE_URL, native)).toBe(expected)
  })
})

describe('DEFAULT_SYNC_URL và SYNC_IS_LOCAL theo môi trường chạy', () => {
  afterEach(() => {
    vi.doUnmock('@capacitor/core')
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function loadClient({ hostname, native, dev }: { hostname: string; native: boolean; dev: boolean }) {
    vi.resetModules()
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }))
    vi.stubGlobal('location', { hostname })
    vi.stubEnv('DEV', dev)
    return import('../client')
  }

  it('APK chạy DEV (shim Robot và Playwright) vẫn trỏ Worker cục bộ, nên nhịp kéo 2 giây', async () => {
    const client = await loadClient({ hostname: 'localhost', native: true, dev: true })
    expect(client.DEFAULT_SYNC_URL).toBe(LOCAL_URL)
    expect(client.SYNC_IS_LOCAL).toBe(true)
  })

  it('APK bản dựng (không DEV) trỏ Worker remote, nên SYNC_IS_LOCAL là false và nhịp kéo 30 giây', async () => {
    const client = await loadClient({ hostname: 'localhost', native: true, dev: false })
    expect(client.DEFAULT_SYNC_URL).toBe(REMOTE_URL)
    expect(client.SYNC_IS_LOCAL).toBe(false)
  })

  it('web chạy ở localhost là sync cục bộ', async () => {
    const client = await loadClient({ hostname: 'localhost', native: false, dev: true })
    expect(client.DEFAULT_SYNC_URL).toBe(LOCAL_URL)
    expect(client.SYNC_IS_LOCAL).toBe(true)
  })
})

describe('pairDevice gửi mã cài đặt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('đưa installId của máy vào body để Worker chuyển dòng heartbeat sang đã ghép', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ shopId: 's1', deviceId: 'd1', token: 't'.repeat(43) }), { status: 201 }),
    )

    await pairDevice({
      code: 'ABC123',
      label: 'Quầy trước',
      letter: 'A',
      hasLocalLedger: false,
      localLedgerRows: 0,
      syncUrl: 'https://sync.example.com',
      installId: INSTALL_ID,
    })

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.installId).toBe(INSTALL_ID)
  })

  it('không truyền installId thì body không có khoá đó', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ shopId: 's1', deviceId: 'd1', token: 't'.repeat(43) }), { status: 201 }),
    )

    await pairDevice({
      code: 'ABC123',
      label: 'Quầy trước',
      letter: 'A',
      hasLocalLedger: false,
      localLedgerRows: 0,
      syncUrl: 'https://sync.example.com',
    })

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect('installId' in body).toBe(false)
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
