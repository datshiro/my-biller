import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCatalogEvents, applyEvents } from '../applier'
import { pullCatalogEvents, pullEvents } from '../client'
import type { LeaderToken } from '../leader'
import { pullAll } from '../puller'
import { getDeviceSyncState } from '../../repositories/device-state'
import type { DeviceConnection } from '@/domain/schema'

vi.mock('../client', () => ({ pullEvents: vi.fn(), pullCatalogEvents: vi.fn() }))
vi.mock('../applier', () => ({ applyEvents: vi.fn(), applyCatalogEvents: vi.fn() }))
vi.mock('../../repositories/device-state', () => ({ getDeviceSyncState: vi.fn() }))

const connection = { key: 'connection' } as unknown as DeviceConnection
const leader = { ownerId: 'o', epoch: 1 } as unknown as LeaderToken
const page = (from: number, count: number, hasMore: boolean) => ({
  events: Array.from({ length: count }, (_, i) => ({ seq: from + i })),
  hasMore,
})
const syncAt = (lastSeq: number, catalogLastSeq = 0) =>
  ({ key: 'sync', lastSeq, catalogLastSeq, revision: 1, resyncRequired: false, lastConnectedAt: null }) as const

beforeEach(() => {
  vi.mocked(pullEvents).mockReset()
  vi.mocked(applyEvents).mockReset().mockResolvedValue(undefined)
  vi.mocked(getDeviceSyncState).mockReset()
  vi.mocked(pullCatalogEvents).mockReset().mockResolvedValue({ events: [], hasMore: false })
  vi.mocked(applyCatalogEvents).mockReset().mockResolvedValue(undefined)
})

describe('pullAll', () => {
  it('kéo trang kế tiếp từ lastSeq mới cho tới khi sổ chung báo hết', async () => {
    vi.mocked(getDeviceSyncState)
      .mockResolvedValueOnce(syncAt(500))
      .mockResolvedValueOnce(syncAt(1000))
      .mockResolvedValueOnce(syncAt(1000))
      .mockResolvedValue(syncAt(1027))
    vi.mocked(pullEvents)
      .mockResolvedValueOnce(page(501, 500, true) as never)
      .mockResolvedValueOnce(page(1001, 27, false) as never)

    await expect(pullAll(connection, leader)).resolves.toBe(527)
    expect(vi.mocked(pullEvents).mock.calls.map(([, since]) => since)).toEqual([500, 1000])
  })

  it('dừng thay vì quay vòng khi sổ chung báo còn trang mà lastSeq không tiến', async () => {
    // Trước đây gateway rơi `since` nên mỗi trang đều là seq 1..500 kèm hasMore=true: applyEvents bỏ
    // qua hết, lastSeq đứng yên, vòng for(;;) kéo mãi (~75 GET/giây) và drainOutbox phía sau không
    // bao giờ tới lượt.
    vi.mocked(getDeviceSyncState).mockResolvedValue(syncAt(500))
    vi.mocked(pullEvents).mockResolvedValue(page(1, 500, true) as never)

    await expect(pullAll(connection, leader)).rejects.toThrow(/trang đã áp dụng/)
    expect(pullEvents).toHaveBeenCalledTimes(1)
    expect(applyEvents).toHaveBeenCalledTimes(1)
    expect(pullCatalogEvents).not.toHaveBeenCalled()
  })

  it('kéo luồng danh mục sau sổ chính, theo con trỏ riêng catalogLastSeq', async () => {
    const order: string[] = []
    vi.mocked(getDeviceSyncState)
      .mockResolvedValueOnce(syncAt(40, 7))
      .mockResolvedValueOnce(syncAt(42, 7))
      .mockResolvedValueOnce(syncAt(42, 507))
      .mockResolvedValueOnce(syncAt(42, 507))
      .mockResolvedValue(syncAt(42, 510))
    vi.mocked(pullEvents).mockImplementation(async () => {
      order.push('ledger')
      return page(41, 2, false) as never
    })
    vi.mocked(pullCatalogEvents)
      .mockImplementationOnce(async () => {
        order.push('catalog')
        return page(8, 500, true) as never
      })
      .mockImplementationOnce(async () => {
        order.push('catalog')
        return page(508, 3, false) as never
      })

    await expect(pullAll(connection, leader)).resolves.toBe(505)
    expect(order).toEqual(['ledger', 'catalog', 'catalog'])
    expect(vi.mocked(pullEvents).mock.calls.map(([, since]) => since)).toEqual([40])
    expect(vi.mocked(pullCatalogEvents).mock.calls.map(([, since]) => since)).toEqual([7, 507])
  })

  it('luồng danh mục dừng khi trang trả lại không làm con trỏ tiến, nhưng không chặn lượt đồng bộ', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(getDeviceSyncState).mockResolvedValue(syncAt(10, 500))
    vi.mocked(pullEvents).mockResolvedValue(page(11, 2, false) as never)
    vi.mocked(pullCatalogEvents).mockResolvedValue(page(1, 500, true) as never)

    await expect(pullAll(connection, leader)).resolves.toBe(2)
    expect(pullCatalogEvents).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]?.[1])).toMatch(/trang danh mục đã áp dụng/)
    logged.mockRestore()
  })

  it('Worker chưa có luồng danh mục (404) thì vẫn trả số đã kéo của sổ chính để runner đi tiếp tới bước đẩy', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(getDeviceSyncState).mockResolvedValue(syncAt(10, 0))
    vi.mocked(pullEvents).mockResolvedValue(page(11, 3, false) as never)
    vi.mocked(pullCatalogEvents).mockRejectedValue(new Error('request-failed'))

    await expect(pullAll(connection, leader)).resolves.toBe(3)
    logged.mockRestore()
  })
})
