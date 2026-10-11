import { getDeviceSyncState } from '../repositories/device-state'
import { applyCatalogEvents, applyEvents } from './applier'
import { pullCatalogEvents, pullEvents } from './client'
import type { LeaderToken } from './leader'
import type { DeviceConnection } from '@/domain/schema'

/**
 * Sổ chính trước rồi luồng danh mục; mỗi luồng giữ con trỏ và đòi seq liền nhau của riêng nó. Lỗi luồng danh mục
 * (Worker chưa lên bản có luồng này, một event hỏng) không được chặn runner đẩy đơn ở bước sau: Worker kiểm tham chiếu
 * nhóm bằng sổ của chính nó, không bằng bản sao trên máy. Con trỏ đứng yên nên lượt sau tự kéo lại.
 */
export async function pullAll(connection: DeviceConnection, leader: LeaderToken): Promise<number> {
  const pulled = await pullLedger(connection, leader)
  try {
    return pulled + (await pullCatalog(connection, leader))
  } catch (caught) {
    console.error('Kéo luồng danh mục lỗi, lượt sau thử lại:', caught)
    return pulled
  }
}

async function pullCatalog(connection: DeviceConnection, leader: LeaderToken): Promise<number> {
  let pulled = 0
  for (;;) {
    const before = (await getDeviceSyncState()).catalogLastSeq
    const batch = await pullCatalogEvents(connection, before)
    await applyCatalogEvents(batch.events, leader)
    pulled += batch.events.length
    if (!batch.hasMore) return pulled
    if ((await getDeviceSyncState()).catalogLastSeq <= before) {
      throw new Error(`Sổ chung trả lại trang danh mục đã áp dụng (seq ≤ ${before}); dừng lượt kéo này.`)
    }
  }
}

async function pullLedger(connection: DeviceConnection, leader: LeaderToken): Promise<number> {
  let pulled = 0
  for (;;) {
    const before = (await getDeviceSyncState()).lastSeq
    const batch = await pullEvents(connection, before)
    await applyEvents(batch.events, leader)
    pulled += batch.events.length
    if (!batch.hasMore) return pulled
    // Sổ chung báo còn trang mà lastSeq không tiến nghĩa là trang vừa nhận đã áp dụng rồi (máy chủ
    // trả sai `since`). Dừng lượt này cho tick sau thử lại để hết vòng nóng kéo mãi một trang. Hàng
    // đợi cố ý đứng chờ tới khi sổ chung trả trang đúng: đẩy vào một sổ chung đang trả sai có thể bị
    // từ chối và cuộn ngược dòng cục bộ.
    if ((await getDeviceSyncState()).lastSeq <= before) {
      throw new Error(`Sổ chung trả lại trang đã áp dụng (seq ≤ ${before}); dừng lượt kéo này.`)
    }
  }
}
