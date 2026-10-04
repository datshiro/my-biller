import { cleanPriceRows } from './backup'
import { ledgerTotals } from './doi-soat'
import { deriveStatus } from './order-status'
import type { BackupData } from './schema'
import type { LedgerTableName } from '@shared/sync-events'

export type CountedTable = Exclude<LedgerTableName, 'settings'>

export type DerivedLedger = {
  data: BackupData
  /**
   * Đơn còn hiệu lực mà tổng khoản thu trừ vào nó vượt tổng đơn. Cùng một lần trả tiền ghi ở hai máy
   * chưa ghép mang hai gid khác nhau nên gộp theo gid không thấy trùng — đây là dấu vết duy nhất còn lại.
   */
  overpaidOrders: number
}

/**
 * Sổ sau khi `recalcAll` chạy, tính thuần. Phải chép **đúng** luật của `recalcAll` (`src/db/recalc.ts`),
 * kể cả chỗ trông lạ: cộng mọi khoản thu đang trừ vào đơn bất kể `unallocatedStatus`, không kẹp
 * `paidAmount` về `total`. Lệch một luật là báo cáo sau khôi phục báo "LỆCH" giả.
 */
export function withDerivedPaid(data: BackupData): DerivedLedger {
  const voidIds = new Set(data.orders.flatMap((order) => (order.status === 'void' ? [order.id] : [])))
  const paidByOrder = new Map<number, number>()
  const payments = data.payments.map((payment) => {
    if (voidIds.has(payment.allocatedOrderId)) return { ...payment, allocatedOrderId: 0 }
    if (payment.allocatedOrderId !== 0) {
      paidByOrder.set(payment.allocatedOrderId, (paidByOrder.get(payment.allocatedOrderId) ?? 0) + payment.amount)
    }
    return payment
  })

  let overpaidOrders = 0
  const orders = data.orders.map((order) => {
    if (order.status === 'void') return { ...order, paidAmount: 0 }
    const paidAmount = paidByOrder.get(order.id) ?? 0
    if (paidAmount > order.total) overpaidOrders += 1
    return { ...order, paidAmount, status: deriveStatus(order.total, paidAmount) }
  })

  return { data: { ...data, orders, payments }, overpaidOrders }
}

/** Kỳ vọng của Ghi đè: `replaceLedger` bỏ dòng giá rác rồi `recalcAll` dựng lại tiền. */
export function expectedAfterReplace(data: BackupData): DerivedLedger {
  return withDerivedPaid({ ...data, customerPrices: cleanPriceRows(data).rows })
}

export type RestoreActual = {
  counts: Record<CountedTable, number>
  debtTotal: number
  /**
   * Khoản thu còn trừ vào đơn đã huỷ trên sổ đọc lại. `recalcAll` phải đưa số này về 0; số đếm và tổng nợ có thể
   * vẫn khớp (khách không còn nợ để trừ tín dụng) nên phải kiểm riêng.
   */
  paymentsOnVoidOrders?: number
}

export type RestoreReportRow = {
  key: CountedTable | 'debtTotal' | 'paymentsOnVoidOrders'
  label: string
  expected: number
  actual: number
  matches: boolean
}

export type RestoreReport = { rows: RestoreReportRow[]; ok: boolean; overpaidOrders: number }

const TABLE_LABELS: Record<CountedTable, string> = {
  orders: 'Đơn',
  customers: 'Khách',
  items: 'Mặt hàng',
  payments: 'Khoản thu',
  itemGroups: 'Nhóm món',
  customerPrices: 'Giá riêng',
  orderLines: 'Dòng hàng',
  expenseCategories: 'Loại chi',
  expenses: 'Khoản chi',
}

const ALWAYS_SHOWN: readonly CountedTable[] = ['orders', 'customers', 'items', 'payments']

/** So sổ kỳ vọng với sổ đọc lại sau khi ghi. Năm dòng luôn hiện; bảng khác chỉ hiện khi lệch. */
export function buildRestoreReport(expected: DerivedLedger, actual: RestoreActual): RestoreReport {
  const tableRows = (Object.keys(TABLE_LABELS) as CountedTable[]).map((key): RestoreReportRow => {
    const want = expected.data[key].length
    const got = actual.counts[key]
    return { key, label: TABLE_LABELS[key], expected: want, actual: got, matches: want === got }
  })
  const debtTotal = ledgerTotals(expected.data).debtTotal
  const onVoid = actual.paymentsOnVoidOrders ?? 0
  const rows: RestoreReportRow[] = [
    ...tableRows.filter((row) => ALWAYS_SHOWN.includes(row.key as CountedTable) || !row.matches),
    { key: 'debtTotal', label: 'Tổng nợ', expected: debtTotal, actual: actual.debtTotal, matches: debtTotal === actual.debtTotal },
    ...(onVoid > 0
      ? [{ key: 'paymentsOnVoidOrders' as const, label: 'Khoản thu trừ vào đơn đã huỷ', expected: 0, actual: onVoid, matches: false }]
      : []),
  ]
  return {
    rows,
    ok: tableRows.every((row) => row.matches) && rows.every((row) => row.matches),
    overpaidOrders: expected.overpaidOrders,
  }
}

/** Dạng trả về của `getLedgerOverview()` → dạng đối chiếu. Bảng vắng trong `counts` tính là 0 dòng. */
export function toReportActual(overview: {
  totals: { debtTotal: number }
  counts: readonly { table: CountedTable; count: number }[]
}): RestoreActual {
  const counts = Object.fromEntries((Object.keys(TABLE_LABELS) as CountedTable[]).map((table) => [table, 0])) as Record<CountedTable, number>
  for (const { table, count } of overview.counts) counts[table] = count
  return { counts, debtTotal: overview.totals.debtTotal }
}
