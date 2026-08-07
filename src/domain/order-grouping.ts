import { groupByDay, type DayGroup } from './day-grouping'
import type { OrderStatus } from './order-status'

type Groupable = { soldAt: number; total: number; status: OrderStatus }

/**
 * Gom đơn theo ngày — trả lời ngay câu "hôm nay bán được bao nhiêu" mà không phải vào Báo cáo.
 *
 * Đơn huỷ vẫn hiện trong danh sách nhưng không cộng vào tổng nhóm.
 */
export function groupOrdersByDay<T extends Groupable>(
  orders: readonly T[],
  now: number,
): DayGroup<T>[] {
  return groupByDay(
    orders,
    now,
    (order) => order.soldAt,
    (order) => (order.status === 'void' ? 0 : order.total),
  )
}
