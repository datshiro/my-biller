import { useLiveQuery } from 'dexie-react-hooks'
import { listOrdersOfDay } from '@/db/repositories/orders'
import { aggregateRevenue } from '@/domain/report'
import { useDayTick } from '@/ui/use-day-tick'

export type TodaySummary = { revenue: number; orderCount: number }

/**
 * Doanh thu hôm nay cho thanh tiêu đề. Mốc ngày tính lúc chạy query; `useDayTick` bắt query chạy lại
 * đúng lúc qua nửa đêm để con số không đứng ở ngày hôm qua khi quán vắng.
 */
export function useToday(): TodaySummary | undefined {
  const day = useDayTick()
  return useLiveQuery(async () => {
    const orders = await listOrdersOfDay(Date.now())
    return {
      revenue: aggregateRevenue(orders),
      orderCount: orders.filter((order) => order.status !== 'void').length,
    }
  }, [day])
}
