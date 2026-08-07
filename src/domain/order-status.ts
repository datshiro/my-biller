export type OrderStatus = 'paid' | 'partial' | 'unpaid' | 'void'
export type DerivedOrderStatus = Exclude<OrderStatus, 'void'>

/** 'void' là trạng thái người dùng đặt (huỷ đơn), không suy diễn được từ tiền — hàm này không bao giờ trả 'void'. */
export function deriveStatus(total: number, paidAmount: number): DerivedOrderStatus {
  if (paidAmount >= total) return 'paid'
  if (paidAmount <= 0) return 'unpaid'
  return 'partial'
}

export function remainingOf(total: number, paidAmount: number): number {
  return Math.max(0, total - paidAmount)
}
