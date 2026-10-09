import { describe, expect, it } from 'vitest'
import { ledgerTotals, type LedgerTotalsInput } from '@/domain/doi-soat'
import type { Customer, Order, Payment } from '@/domain/schema'
import { testGid } from '@/test-fixtures'
import { summarizeServerLedger } from '@shared/ledger-money'

const customerGid = (id: number) => testGid(100 + id)
const orderGid = (id: number) => testGid(200 + id)
const paymentGid = (id: number) => testGid(300 + id)
const day = (date: number) => new Date(2026, 7, date, 10).getTime()

const customer = (id: number, name: string): Customer => ({
  id,
  gid: customerGid(id),
  name,
  phone: '',
  address: '',
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const order = (
  id: number,
  customerId: number | null,
  total: number,
  paidAmount: number,
  status: Order['status'],
  soldDay: number,
): Order => ({
  id,
  gid: orderGid(id),
  code: `PBH-260809-${String(id).padStart(3, '0')}`,
  originalCode: '',
  customerId,
  customerName: '',
  subtotal: total,
  discount: 0,
  surcharge: 0,
  total,
  paidAmount,
  status,
  soldAt: day(soldDay),
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const payment = (
  id: number,
  orderId: number,
  allocatedOrderId: number,
  customerId: number | null,
  amount: number,
  unallocatedStatus?: 'refunded' | 'discarded',
): Payment => ({
  id,
  gid: paymentGid(id),
  orderId,
  allocatedOrderId,
  customerId,
  amount,
  method: 'cash',
  paidAt: day(9),
  note: '',
  unallocatedStatus,
})

// Khách 3 đã xoá khỏi sổ nhưng đơn của khách đó vẫn còn: không có dòng customers, gid vẫn suy ra được.
const dataset: LedgerTotalsInput = {
  customers: [customer(1, 'Chị Hoa'), customer(2, 'Anh Nam')],
  orders: [
    order(1, 1, 100_000, 0, 'unpaid', 1),
    order(2, 1, 50_000, 20_000, 'partial', 2),
    order(3, 1, 80_000, 80_000, 'paid', 3),
    order(4, 1, 200_000, 50_000, 'void', 4),
    order(5, null, 60_000, 10_000, 'partial', 5),
    order(6, 2, 40_000, 0, 'unpaid', 6),
    order(7, 3, 70_000, 0, 'unpaid', 7),
  ],
  payments: [
    payment(1, 2, 2, 1, 20_000),
    payment(2, 4, 4, 1, 50_000),
    payment(3, 5, 5, null, 10_000),
    payment(4, 3, 0, 1, 30_000, 'refunded'),
    payment(5, 1, 0, 1, 15_000, 'discarded'),
    payment(6, 6, 0, 2, 90_000),
  ],
  expenses: [],
}

// Dựng hàng `ledger` như DO lưu: khoá FK cục bộ bỏ khỏi `after`, quan hệ nằm ở `refs` dưới dạng gid
// (xem canonicalizeReferences trong worker/src/shop-do.ts).
function toServerRows(data: LedgerTotalsInput): { tableName: string; payload: string }[] {
  const without = (row: object, keys: readonly string[]) => {
    const copy: Record<string, unknown> = { ...row }
    for (const key of keys) delete copy[key]
    return copy
  }
  const nullableGid = (id: number | null, gidOf: (id: number) => string) => (id === null ? null : gidOf(id))

  return [
    ...data.customers.map((row) => ({
      tableName: 'customers',
      payload: JSON.stringify({ after: without(row, ['id']), refs: {} }),
    })),
    ...data.orders.map((row) => ({
      tableName: 'orders',
      payload: JSON.stringify({
        after: without(row, ['id', 'customerId']),
        refs: { customerId: nullableGid(row.customerId, customerGid) },
      }),
    })),
    ...data.payments.map((row) => ({
      tableName: 'payments',
      payload: JSON.stringify({
        after: without(row, ['id', 'orderId', 'allocatedOrderId', 'customerId']),
        refs: {
          orderId: orderGid(row.orderId),
          allocatedOrderId: row.allocatedOrderId === 0 ? null : orderGid(row.allocatedOrderId),
          customerId: nullableGid(row.customerId, customerGid),
        },
      }),
    })),
  ]
}

const local = ledgerTotals(dataset)
const server = summarizeServerLedger(toServerRows(dataset))

describe('summarizeServerLedger khớp ledgerTotals trên cùng một sổ', () => {
  it('doanh thu, tổng nợ, số đơn (gồm đơn huỷ) và số khách bằng nhau', () => {
    expect(server.revenue).toBe(local.revenue)
    expect(server.debtTotal).toBe(local.debtTotal)
    expect(server.orderCount).toBe(dataset.orders.length)
    expect(server.customerCount).toBe(dataset.customers.length)
  })

  it('nợ của từng khách còn trong sổ bằng debtByCustomerGid', () => {
    for (const { gid } of dataset.customers) {
      const serverDebt = server.debts.find((debt) => debt.customerGid === gid)?.total
      expect(serverDebt).toBe(local.debtByCustomerGid.get(gid))
    }
  })

  it('khách đã xoá vẫn nằm trong tổng nợ nhưng không có trong bảng nợ theo khách còn sổ', () => {
    expect(local.debtByCustomerGid.has(customerGid(3))).toBe(false)
    expect(server.debts.find((debt) => debt.customerGid === customerGid(3))?.total).toBe(70_000)
  })
})

describe('bộ mẫu parity không qua loa', () => {
  it('ra doanh thu 400 000, nợ 200 000, 7 đơn, 2 khách còn sổ', () => {
    expect(local.revenue).toBe(400_000)
    expect(local.debtTotal).toBe(200_000)
    expect(dataset.orders).toHaveLength(7)
    expect(dataset.customers).toHaveLength(2)
  })

  it('có khách bị kẹp về 0 do tiền trả trước lớn hơn nợ', () => {
    expect(dataset.orders.some((row) => row.customerId === 2 && row.status === 'unpaid')).toBe(true)
    expect(dataset.payments.some((row) => row.customerId === 2 && row.allocatedOrderId === 0)).toBe(true)
    expect(local.debtByCustomerGid.has(customerGid(2))).toBe(false)
    expect(server.debts.some((debt) => debt.customerGid === customerGid(2))).toBe(false)
  })
})

describe('summarizeServerLedger với hàng hỏng', () => {
  it('payload không phải JSON hợp lệ làm ném lỗi kèm tên bảng', () => {
    expect(() => summarizeServerLedger([{ tableName: 'payments', payload: '{"after":' }])).toThrow(/payments/)
  })
})
