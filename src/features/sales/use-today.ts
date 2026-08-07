import { useLiveQuery } from 'dexie-react-hooks'
import { listOrdersOfDay } from '@/db/repositories/orders'
import { aggregateRevenue } from '@/domain/report'

export type TodaySummary = { revenue: number; orderCount: number }

/**
 * Doanh thu hôm nay cho thanh tiêu đề. Mốc ngày tính lúc chạy query nên qua nửa đêm,
 * lần đọc kế tiếp đã tự sang ngày mới.
 */
export function useToday(): TodaySummary | undefined {
  return useLiveQuery(async () => {
    const orders = await listOrdersOfDay(Date.now())
    return {
      revenue: aggregateRevenue(orders),
      orderCount: orders.filter((order) => order.status !== 'void').length,
    }
  })
}
