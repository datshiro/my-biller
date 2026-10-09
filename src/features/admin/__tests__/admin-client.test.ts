// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient, mergeRows } from '../admin-client'
import { DEFAULT_SYNC_URL } from '@/db/sync/client'
import type { AdminDataRow } from '@shared/admin-contract'
import { SECRET, SHOP_A, spyStorageWrites } from './admin-fixtures'

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function requestAt(index: number): { url: URL; init: RequestInit } {
  const call = fetchMock.mock.calls[index]
  if (!call) throw new Error(`không có lời gọi fetch thứ ${index}`)
  return { url: new URL(String(call[0])), init: call[1] ?? {} }
}

function bearerOf(init: RequestInit): string | null {
  return new Headers(init.headers).get('authorization')
}

function row(entityKey: string, updatedSeq: number): AdminDataRow {
  return { entityKey, updatedSeq, after: {}, refs: {} }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createAdminClient', () => {
  it('gửi Bearer mang đúng mật khẩu vừa nhập', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ shops: [], next: null }))
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadShops()

    const { url, init } = requestAt(0)
    expect(url.href.startsWith(`${DEFAULT_SYNC_URL}/admin/shops`)).toBe(true)
    expect(bearerOf(init)).toBe(`Bearer ${SECRET}`)
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('401 gọi onUnauthorized đúng một lần và ném lỗi mã unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))
    const onUnauthorized = vi.fn()
    const client = createAdminClient(SECRET, onUnauthorized)

    await expect(client.loadShops()).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('429 ném lỗi rate-limited và không coi là hết phiên', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate-limited' }, 429))
    const onUnauthorized = vi.fn()
    const client = createAdminClient(SECRET, onUnauthorized)

    await expect(client.loadShops()).rejects.toMatchObject({ code: 'rate-limited', status: 429 })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('503 admin-unavailable được ném nguyên mã cho màn hình', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'admin-unavailable' }, 503))
    const client = createAdminClient(SECRET, vi.fn())

    await expect(client.loadUnpaired()).rejects.toMatchObject({ code: 'admin-unavailable', status: 503 })
  })

  it('không ghi gì vào localStorage hay sessionStorage trong suốt các lượt gọi', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ shops: [], next: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ rows: [], next: null }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ devices: [], total: 0, new24h: 0 }))
    const writes = spyStorageWrites()
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadShops()
    await client.loadData(SHOP_A, 'orders', 0)
    await client.loadUnpaired()

    for (const spy of writes) expect(spy).not.toHaveBeenCalled()
  })

  it('loadShops gửi limit=20 và cursor khi có trang sau', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ shops: [], next: null }))
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadShops('shop-cursor-1')

    const { url, init } = requestAt(0)
    expect(url.pathname.endsWith('/admin/shops')).toBe(true)
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('cursor')).toBe('shop-cursor-1')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('loadShop đọc đúng đường của một sổ, không kèm đường data', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ shopId: SHOP_A, debts: [] }))
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadShop(SHOP_A)

    const { url } = requestAt(0)
    expect(url.pathname.endsWith(`/admin/shops/${SHOP_A}`)).toBe(true)
  })

  it('loadData luôn gửi limit dương cùng table và mốc after', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], next: null }))
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadData(SHOP_A, 'customers', 40)

    const { url, init } = requestAt(0)
    expect(url.pathname.endsWith(`/admin/shops/${SHOP_A}/data`)).toBe(true)
    expect(url.searchParams.get('table')).toBe('customers')
    expect(url.searchParams.get('after')).toBe('40')
    expect(Number(url.searchParams.get('limit'))).toBeGreaterThanOrEqual(1)
    expect(url.searchParams.has('orderIds')).toBe(false)
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('loadOrderLines với đúng 50 gid gọi mạng một lần và đủ 50 gid trong orderIds', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], next: null }))
    const client = createAdminClient(SECRET, vi.fn())
    const gids = Array.from({ length: 50 }, (_, index) => `order-${index + 1}`)

    await client.loadOrderLines(SHOP_A, gids, 0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url } = requestAt(0)
    expect(url.searchParams.get('table')).toBe('orderLines')
    expect(url.searchParams.get('limit')).not.toBeNull()
    const sent = url.searchParams.get('orderIds')?.split(',') ?? []
    expect(sent).toHaveLength(50)
    expect(sent).toEqual(gids)
  })

  it('loadOrderLines với 51 gid ném lỗi trước khi gọi mạng', async () => {
    const client = createAdminClient(SECRET, vi.fn())
    const gids = Array.from({ length: 51 }, (_, index) => `order-${index + 1}`)

    await expect(async () => client.loadOrderLines(SHOP_A, gids, 0)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loadUnpaired gọi đúng đường máy chưa ghép, chỉ GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ devices: [], total: 0, new24h: 0 }))
    const client = createAdminClient(SECRET, vi.fn())

    await client.loadUnpaired()

    const { url, init } = requestAt(0)
    expect(url.pathname.endsWith('/admin/devices/unpaired')).toBe(true)
    expect(init.method ?? 'GET').toBe('GET')
  })
})

describe('mergeRows', () => {
  it('ghép hai trang không lặp entityKey và giữ thứ tự xuất hiện', () => {
    const merged = mergeRows([row('o-1', 10), row('o-2', 11)], [row('o-3', 12)])

    expect(merged.map((item: AdminDataRow) => item.entityKey)).toEqual(['o-1', 'o-2', 'o-3'])
  })

  it('một entityKey xuất hiện ở cả hai trang chỉ còn một dòng, giữ bản có updatedSeq mới hơn', () => {
    const merged = mergeRows([row('o-1', 10), row('o-2', 11)], [row('o-2', 12), row('o-3', 13)])

    expect(merged.map((item: AdminDataRow) => item.entityKey)).toEqual(['o-1', 'o-2', 'o-3'])
    expect(merged.find((item: AdminDataRow) => item.entityKey === 'o-2')?.updatedSeq).toBe(12)
  })
})
