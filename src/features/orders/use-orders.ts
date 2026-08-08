import { endOfDay, startOfDay, subDays } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getOrder,
  getOrderLines,
  getOrderPayments,
  hasOrdersBefore,
  listOrdersBetween,
  summarizeOrders,
  type OrderSummary,
} from '@/db/repositories/orders'
import type { DayGroup } from '@/domain/day-grouping'
import { groupOrdersByDay } from '@/domain/order-grouping'
import type { Order, OrderLine, Payment } from '@/domain/schema'
import { useDayTick } from '@/ui/use-day-tick'

export type OrderWindow = {
  groups: DayGroup<Order>[]
  summaries: Map<number, OrderSummary>
  /** Còn đơn cũ hơn khoảng đang xem — dùng để quyết định có hiện nút "Xem thêm" không. */
  hasOlder: boolean
}

/**
 * Đọc theo cửa sổ ngày rồi nới dần, thay vì kéo cả bảng đơn về mỗi lần mở màn.
 * Gom nhóm luôn ở đây: nhãn "Hôm nay / Hôm qua" cần mốc thời gian, mà đọc đồng hồ trong lúc render
 * thì mỗi lần vẽ lại ra một kết quả khác.
 */
export function useOrderWindow(days: number): OrderWindow | undefined {
  const day = useDayTick()
  return useLiveQuery(async () => {
    const now = Date.now()
    const from = startOfDay(subDays(now, days - 1)).getTime()
    const orders = await listOrdersBetween(from, endOfDay(now).getTime())
    const [summaries, hasOlder] = await Promise.all([
      summarizeOrders(orders.flatMap((order) => (order.id === undefined ? [] : [order.id]))),
      hasOrdersBefore(from),
    ])
    return { groups: groupOrdersByDay(orders, now), summaries, hasOlder }
  }, [days, day])
}

export type OrderDetail = { order: Order; lines: OrderLine[]; payments: Payment[] }

/** `undefined` = đang đọc, `null` = không có đơn này. */
export function useOrderDetail(orderId: number): OrderDetail | null | undefined {
  return useLiveQuery(async () => {
    if (!Number.isInteger(orderId) || orderId <= 0) return null
    const order = await getOrder(orderId)
    if (!order) return null

    const [lines, payments] = await Promise.all([getOrderLines(orderId), getOrderPayments(orderId)])
    return { order, lines, payments }
  }, [orderId])
}
