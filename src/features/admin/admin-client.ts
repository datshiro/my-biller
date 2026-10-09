import { DEFAULT_SYNC_URL, SyncApiError, jsonRequest } from '@/db/sync/client'
import type {
  AdminDataPage,
  AdminDataRow,
  AdminShopsPage,
  ShopDetail,
  UnpairedPage,
} from '@shared/admin-contract'
import type { LedgerTableName } from '@shared/ledger-schemas'

export const SHOPS_PAGE_SIZE = 20
export const DATA_PAGE_SIZE = 50
/** Trần của Worker cho một trang `/data`; 50 đơn thường có nhiều hơn 50 dòng đơn. */
const ORDER_LINES_PAGE_SIZE = 200
const ORDER_IDS_MAX = 50

export type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Mọi lời gọi là GET mang Bearer. Secret chỉ nằm trong closure này — không ghi storage, không log.
 * 401 nghĩa là phiên xem hết hiệu lực: báo cho trang để xoá secret khỏi state.
 */
export function createAdminClient(secret: string, onUnauthorized: () => void) {
  const get = async <T>(path: string, query: Record<string, string> = {}): Promise<T> => {
    const search = new URLSearchParams(query).toString()
    try {
      return await jsonRequest<T>(`${DEFAULT_SYNC_URL}${path}${search ? `?${search}` : ''}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
      })
    } catch (caught) {
      if (caught instanceof SyncApiError && caught.status === 401) onUnauthorized()
      throw caught
    }
  }
  const shopPath = (shopId: string) => `/admin/shops/${encodeURIComponent(shopId)}`

  return {
    loadShops: (cursor?: string) =>
      get<AdminShopsPage>('/admin/shops', {
        limit: String(SHOPS_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      }),
    loadShop: (shopId: string) => get<ShopDetail>(shopPath(shopId)),
    loadData: (shopId: string, table: LedgerTableName, after = 0) =>
      get<AdminDataPage>(`${shopPath(shopId)}/data`, {
        table,
        after: String(after),
        limit: String(DATA_PAGE_SIZE),
      }),
    loadOrderLines: async (shopId: string, orderGids: readonly string[], after = 0) => {
      if (orderGids.length > ORDER_IDS_MAX) {
        throw new Error(`Mỗi lần chỉ lấy dòng đơn của tối đa ${ORDER_IDS_MAX} đơn, nhận ${orderGids.length}`)
      }
      return get<AdminDataPage>(`${shopPath(shopId)}/data`, {
        table: 'orderLines',
        after: String(after),
        limit: String(ORDER_LINES_PAGE_SIZE),
        orderIds: orderGids.join(','),
      })
    },
    loadUnpaired: () => get<UnpairedPage>('/admin/devices/unpaired'),
  }
}

/** Ghép trang mới vào danh sách đã có: một `entityKey` chỉ một dòng, giữ bản `updatedSeq` lớn hơn, giữ thứ tự xuất hiện. */
export function mergeRows(prev: readonly AdminDataRow[], next: readonly AdminDataRow[]): AdminDataRow[] {
  const byKey = new Map<string, AdminDataRow>()
  for (const row of [...prev, ...next]) {
    const kept = byKey.get(row.entityKey)
    if (!kept || row.updatedSeq > kept.updatedSeq) byKey.set(row.entityKey, row)
  }
  return [...byKey.values()]
}
