import { getDeviceSyncState } from '../repositories/device-state'
import { applyEvents } from './applier'
import { pullEvents } from './client'
import type { LeaderToken } from './leader'
import type { DeviceConnection } from '@/domain/schema'

export async function pullAll(connection: DeviceConnection, leader: LeaderToken): Promise<number> {
  let pulled = 0
  for (;;) {
    const before = (await getDeviceSyncState()).lastSeq
    const batch = await pullEvents(connection, before)
    await applyEvents(batch.events, leader)
    pulled += batch.events.length
    if (!batch.hasMore) return pulled
    // Sổ chung báo còn trang mà lastSeq không tiến nghĩa là trang vừa nhận đã áp dụng rồi (máy chủ
    // trả sai `since`). Dừng lượt này cho tick sau thử lại, thay vì quay vòng nóng kéo mãi một trang
    // và chặn luôn bước đưa hàng đợi lên đứng sau.
    if ((await getDeviceSyncState()).lastSeq <= before) {
      throw new Error(`Sổ chung trả lại trang đã áp dụng (seq ≤ ${before}); dừng lượt kéo này.`)
    }
  }
}
