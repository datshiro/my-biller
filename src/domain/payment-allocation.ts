import { assertMoney } from './money'

export type OpenOrder = { orderId: number; gid: string; remaining: number; soldAt: number }
export type Allocation = { orderId: number; amount: number }
export type AllocationResult = { allocations: Allocation[]; leftover: number }

/**
 * Trả nợ theo thứ tự đơn cũ nhất trước.
 * Phần không phân bổ được trả về `leftover` — hàm này không bao giờ tự tạo tiền thừa;
 * người gọi quyết định từ chối hay hoàn lại (Phase 7 từ chối và rollback).
 */
export function allocateDebtPayment(
  openOrders: readonly OpenOrder[],
  amount: number,
): AllocationResult {
  assertMoney(amount, 'Số tiền thu')

  const queue = [...openOrders]
    .filter((order) => order.remaining > 0)
    .sort((a, b) => a.soldAt - b.soldAt || a.gid.localeCompare(b.gid))

  const allocations: Allocation[] = []
  let left = amount

  for (const order of queue) {
    if (left <= 0) break
    const paid = Math.min(order.remaining, left)
    allocations.push({ orderId: order.orderId, amount: paid })
    left -= paid
  }

  return { allocations, leftover: left }
}
