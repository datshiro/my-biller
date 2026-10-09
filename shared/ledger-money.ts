export type OrderStatus = 'paid' | 'partial' | 'unpaid' | 'void'

export function remainingOf(total: number, paidAmount: number): number {
  return Math.max(0, total - paidAmount)
}

export type DebtOrder = {
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
 * Phiếu thu còn được tính vào tiền hay không.
 *
 * `refunded` là tiền đã trả lại khách, `discarded` là khoản ghi nhận sai đã có ghi vết. Cả hai vẫn
 * nằm trong lịch sử (phiếu thu không xoá được) nhưng không còn là tiền của quán. Một chỗ duy nhất
 * cho năm nơi hỏi cùng câu này — và hai trong năm không phải màn đọc: hàm này nằm trên đường in
 * phiếu (`use-receipt.ts`) và trong cổng ghi của thu nợ (`payments.ts`, trong `syncTransaction`).
 * Sửa nó là sửa cả tiền in ra giấy lẫn tiền ghi xuống sổ, không chỉ một con số trên màn hình.
 */
export function isCountedPayment(payment: {
  unallocatedStatus?: 'pending' | 'refunded' | 'discarded'
}): boolean {
  return (payment.unallocatedStatus ?? 'pending') === 'pending'
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

export type ServerLedgerRow = { tableName: string; payload: string }

export type ServerCustomerDebt = {
  customerGid: string
  total: number
  orderCount: number
  oldestAt: number
}

export type ServerLedgerSummary = {
  /** Gồm cả đơn huỷ, như số dòng `orders` ở Đối soát. */
  orderCount: number
  customerCount: number
  debtTotal: number
  revenue: number
  debts: ServerCustomerDebt[]
}

type ServerOrderAfter = { total: number; paidAmount: number; soldAt: number; status: OrderStatus }
type ServerPaymentAfter = { amount: number; unallocatedStatus?: 'pending' | 'refunded' | 'discarded' }
type ServerRefs = { customerId?: string | null; allocatedOrderId?: string | null }

/**
 * Bốn số của một sổ tính từ hàng `ledger` của server, cùng công thức với `ledgerTotals` ở Đối soát.
 *
 * Hàng server chỉ có gid (khoá cục bộ bị bỏ khi lên sổ), còn `groupDebts` nhận khoá số. Nên gid khách
 * được gán số thứ tự tại chỗ rồi dịch ngược lại, giống cách `ledgerTotals` dịch id ↔ gid — nhờ vậy
 * công thức nợ chỉ có một bản.
 */
export function summarizeServerLedger(rows: readonly ServerLedgerRow[]): ServerLedgerSummary {
  const ordinals = new Map<string, number>()
  const gidsByOrdinal = new Map<number, string>()
  const ordinalOf = (gid: string) => {
    let ordinal = ordinals.get(gid)
    if (ordinal === undefined) {
      ordinal = ordinals.size + 1
      ordinals.set(gid, ordinal)
      gidsByOrdinal.set(ordinal, gid)
    }
    return ordinal
  }

  const orders: DebtOrder[] = []
  const unallocated = new Map<number, number>()
  let customerCount = 0
  let revenue = 0

  for (const row of rows) {
    let parsed: { after: unknown; refs?: ServerRefs }
    try {
      parsed = JSON.parse(row.payload)
    } catch {
      throw new Error(`Hàng ledger hỏng JSON ở bảng ${row.tableName}`)
    }
    const refs = parsed.refs ?? {}

    if (row.tableName === 'customers') {
      customerCount += 1
    } else if (row.tableName === 'orders') {
      const after = parsed.after as ServerOrderAfter
      const customerGid = refs.customerId ?? null
      orders.push({
        customerId: customerGid === null ? null : ordinalOf(customerGid),
        total: after.total,
        paidAmount: after.paidAmount,
        soldAt: after.soldAt,
        status: after.status,
      })
      if (after.status !== 'void') revenue += after.total
    } else if (row.tableName === 'payments') {
      const after = parsed.after as ServerPaymentAfter
      const customerGid = refs.customerId ?? null
      if ((refs.allocatedOrderId ?? null) !== null || customerGid === null) continue
      if (!isCountedPayment(after)) continue
      const ordinal = ordinalOf(customerGid)
      unallocated.set(ordinal, (unallocated.get(ordinal) ?? 0) + after.amount)
    }
  }

  const groups = groupDebts(orders, unallocated)
  return {
    orderCount: orders.length,
    customerCount,
    debtTotal: totalDebt(groups),
    revenue,
    debts: groups.map((group) => ({
      customerGid: gidsByOrdinal.get(group.customerId)!,
      total: group.total,
      orderCount: group.orderCount,
      oldestAt: group.oldestAt,
    })),
  }
}
