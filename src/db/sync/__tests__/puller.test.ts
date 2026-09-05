import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyEvents } from '../applier'
import { pullEvents } from '../client'
import type { LeaderToken } from '../leader'
import { pullAll } from '../puller'
import { getDeviceSyncState } from '../../repositories/device-state'
import type { DeviceConnection } from '@/domain/schema'

vi.mock('../client', () => ({ pullEvents: vi.fn() }))
vi.mock('../applier', () => ({ applyEvents: vi.fn() }))
vi.mock('../../repositories/device-state', () => ({ getDeviceSyncState: vi.fn() }))

const connection = { key: 'connection' } as unknown as DeviceConnection
const leader = { ownerId: 'o', epoch: 1 } as unknown as LeaderToken
const page = (from: number, count: number, hasMore: boolean) => ({
  events: Array.from({ length: count }, (_, i) => ({ seq: from + i })),
  hasMore,
})
const syncAt = (lastSeq: number) =>
  ({ key: 'sync', lastSeq, revision: 1, resyncRequired: false, lastConnectedAt: null }) as const

beforeEach(() => {
  vi.mocked(pullEvents).mockReset()
  vi.mocked(applyEvents).mockReset().mockResolvedValue(undefined)
  vi.mocked(getDeviceSyncState).mockReset()
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
  })
})
