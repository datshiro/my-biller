import { differenceInCalendarDays } from 'date-fns'
import { remainingOf, type OrderStatus } from './order-status'

type DebtOrder = {
  customerId: number | null
  total: number
  paidAmount: number
  soldAt: number
  status: OrderStatus
}

export type DebtGroup = {
  customerId: number
  total: number
  orderCount: number
  /** Đơn nợ cũ nhất của khách — quyết định thứ tự danh sách và số ngày nợ. */
  oldestAt: number
}

/** Số tiền một đơn còn thiếu. Đơn huỷ không còn nợ ai. */
export function owingOf(order: DebtOrder): number {
  return order.status === 'void' ? 0 : remainingOf(order.total, order.paidAmount)
}

/**
 * Gộp nợ theo khách, nợ lâu nhất lên đầu.
 *
 * Đơn không gắn khách bị **loại hẳn**: nợ là tiền của một người cụ thể, đơn khách lẻ mà chưa trả đủ
 * là lỗi dữ liệu chứ không phải công nợ. Bán nợ đã bắt buộc chọn khách từ màn bán hàng. Nhờ loại ở
 * đây mà tổng nợ trên trang khách, màn Công nợ và card Báo cáo luôn bằng nhau — cả ba đọc hàm này.
 */
export function groupDebts(
  orders: readonly DebtOrder[],
  unallocatedByCustomer: ReadonlyMap<number, number> = new Map(),
): DebtGroup[] {
  const byCustomer = new Map<number, DebtGroup>()

  for (const order of orders) {
    const owing = owingOf(order)
    if (order.customerId === null || owing <= 0) continue

    const current = byCustomer.get(order.customerId)
    if (current) {
      current.total += owing
      current.orderCount += 1
      current.oldestAt = Math.min(current.oldestAt, order.soldAt)
    } else {
      byCustomer.set(order.customerId, {
        customerId: order.customerId,
        total: owing,
        orderCount: 1,
        oldestAt: order.soldAt,
      })
    }
  }

  for (const [customerId, credit] of unallocatedByCustomer) {
    const group = byCustomer.get(customerId)
    if (!group) continue
    group.total = Math.max(0, group.total - credit)
    if (group.total === 0) byCustomer.delete(customerId)
  }

  return [...byCustomer.values()].sort((a, b) => a.oldestAt - b.oldestAt)
}

export function totalDebt(groups: readonly DebtGroup[]): number {
  return groups.reduce((sum, group) => sum + group.total, 0)
}

/** Tính theo ngày lịch: bán 23:00 hôm qua, sáng nay đã là "1 ngày" đúng như người bán đếm. */
export function daysOwed(oldestAt: number, now: number): number {
  return differenceInCalendarDays(now, oldestAt)
}
