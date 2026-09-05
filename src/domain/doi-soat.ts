import { groupDebts, isCountedPayment, totalDebt } from './debt'
import type { BackupData, Customer, Expense, Order, Payment } from './schema'

export type LedgerTotals = {
  revenue: number
  expenses: number
  collected: number
  /** Tổng mọi nhóm nợ, kể cả nhóm của khách không còn trong `customers` — cùng số với màn Công nợ. */
  debtTotal: number
  /** Chỉ nhóm tra được gid; dùng để đối chiếu từng khách qua đường gộp sổ. */
  debtByCustomerGid: Map<string, number>
}

/**
 * Bốn bảng đủ để tính tổng. Khai theo kiểu hàng DB (`id` tuỳ chọn) chứ không theo `BackupData` (`id`
 * bắt buộc): nhờ vậy cả file sao lưu lẫn `toArray()` từ IndexedDB đều gán thẳng vào được.
 */
export type LedgerTotalsInput = {
  orders: readonly Order[]
  payments: readonly Payment[]
  expenses: readonly Expense[]
  customers: readonly Customer[]
}

export function ledgerTotals(data: LedgerTotalsInput): LedgerTotals {
  const customerGids = new Map(data.customers.map((customer) => [customer.id, customer.gid]))
  const unallocated = new Map<number, number>()
  for (const payment of data.payments) {
    if (payment.allocatedOrderId !== 0 || payment.customerId === null) continue
    if (!isCountedPayment(payment)) continue
    unallocated.set(
      payment.customerId,
      (unallocated.get(payment.customerId) ?? 0) + payment.amount,
    )
  }

  const groups = groupDebts(data.orders, unallocated)
  const debtByCustomerGid = new Map<string, number>()
  for (const group of groups) {
    const gid = customerGids.get(group.customerId)
    if (gid) debtByCustomerGid.set(gid, group.total)
  }

  return {
    revenue: data.orders.reduce(
      (sum, order) => sum + (order.status === 'void' ? 0 : order.total),
      0,
    ),
    expenses: data.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    collected: data.payments.reduce(
      (sum, payment) => sum + (isCountedPayment(payment) ? payment.amount : 0),
      0,
    ),
    debtTotal: totalDebt(groups),
    debtByCustomerGid,
  }
}

const addDebt = (target: Map<string, number>, source: ReadonlyMap<string, number>, remap: Readonly<Record<string, string>>) => {
  for (const [gid, amount] of source) {
    const key = remap[gid] ?? gid
    target.set(key, (target.get(key) ?? 0) + amount)
  }
}

/** Ném trước khi file gộp được ghi nếu lệch dù một đồng. */
export function assertReconciled(
  a: BackupData,
  b: BackupData,
  merged: BackupData,
  customerGidMerges: Readonly<Record<string, string>> = {},
): LedgerTotals {
  const left = ledgerTotals(a)
  const right = ledgerTotals(b)
  const actual = ledgerTotals(merged)
  const expectedDebt = new Map<string, number>()
  addDebt(expectedDebt, left.debtByCustomerGid, {})
  addDebt(expectedDebt, right.debtByCustomerGid, customerGidMerges)

  const scalarChecks = [
    ['doanh thu', actual.revenue, left.revenue + right.revenue],
    ['chi phí', actual.expenses, left.expenses + right.expenses],
    ['đã thu', actual.collected, left.collected + right.collected],
  ] as const
  for (const [label, got, expected] of scalarChecks) {
    if (got !== expected) throw new Error(`Đối soát lệch ${label}: ${got} ≠ ${expected}.`)
  }

  const gids = new Set([...expectedDebt.keys(), ...actual.debtByCustomerGid.keys()])
  for (const gid of gids) {
    const got = actual.debtByCustomerGid.get(gid) ?? 0
    const expected = expectedDebt.get(gid) ?? 0
    if (got !== expected) throw new Error(`Đối soát lệch công nợ khách ${gid}: ${got} ≠ ${expected}.`)
  }

  return actual
}
