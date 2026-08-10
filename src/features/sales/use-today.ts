import { useLiveQuery } from 'dexie-react-hooks'
import { listOrdersOfDay } from '@/db/repositories/orders'
import { aggregateRevenue } from '@/domain/report'
import { useDayTick } from '@/ui/use-day-tick'
import { useSyncRevision } from '@/features/sync/use-sync-revision'

export type TodaySummary = { revenue: number; orderCount: number }

/**
 * Doanh thu hôm nay cho thanh tiêu đề. Mốc ngày tính lúc chạy query; `useDayTick` bắt query chạy lại
 * đúng lúc qua nửa đêm để con số không đứng ở ngày hôm qua khi quán vắng.
 */
export function useToday(): TodaySummary | undefined {
  const day = useDayTick()
  const syncRevision = useSyncRevision()
  return useLiveQuery(async () => {
    const orders = await listOrdersOfDay(Date.now())
    return {
      revenue: aggregateRevenue(orders),
      orderCount: orders.filter((order) => order.status !== 'void').length,
    }
  }, [day, syncRevision])
}
