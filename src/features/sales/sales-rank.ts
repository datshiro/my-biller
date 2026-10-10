import { endOfDay, format, startOfDay, subDays } from 'date-fns'
import { listOrderLinesOfOrders, listOrdersBetween, WIDE_QUERY } from '@/db/repositories/orders'
import { aggregate } from '@/domain/report'

export type SalesRank = ReadonlyMap<number, number>

const RANK_DAYS = 14

let cached: { day: string; rank: SalesRank } | null = null

export const rankDay = (now: number) => format(now, 'yyyy-MM-dd')

/**
 * Thứ hạng chỉ đọc một lần mỗi ngày. Chốt đơn xong app sang màn phiếu rồi quay lại, nên màn bán mount
 * lại sau mỗi đơn — đọc lại lúc đó là lưới xếp lại ngay trước ngón tay người bán.
 */
export function cachedSalesRank(now: number): SalesRank | undefined {
  return cached?.day === rankDay(now) ? cached.rank : undefined
}

/** Cùng thước đo với bảng bán chạy của Báo cáo: doanh thu, bỏ đơn huỷ — `aggregate` là chỗ duy nhất lọc đơn huỷ. */
export async function loadSalesRank(now: number): Promise<SalesRank> {
  const hit = cachedSalesRank(now)
  if (hit) return hit

  const inRange = await listOrdersBetween(startOfDay(subDays(now, RANK_DAYS - 1)).getTime(), endOfDay(now).getTime())
  // Chạm ngưỡng là `listOrderLinesOfOrders` đọc cả bảng `orderLines`; quán đông thì bỏ bớt đơn cũ nhất.
  const orders =
    inRange.length < WIDE_QUERY ? inRange : [...inRange].sort((a, b) => b.soldAt - a.soldAt).slice(0, WIDE_QUERY - 1)
  const lines = await listOrderLinesOfOrders(orders.flatMap((order) => (order.id === undefined ? [] : [order.id])))
  const { topItems } = aggregate({ orders, lines, payments: [], expenses: [] })

  const rank = new Map<number, number>()
  for (const top of topItems) {
    if (top.key.startsWith('item:')) rank.set(Number(top.key.slice('item:'.length)), rank.size)
  }
  cached = { day: rankDay(now), rank }
  return rank
}

export function resetSalesRankCache() {
  cached = null
}
