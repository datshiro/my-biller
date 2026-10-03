import type { BackupData, Order, Payment } from '../schema'
import { testGid } from '@/test-fixtures'

export const at = new Date(2026, 9, 1, 10).getTime()

type Row<T extends keyof BackupData> = BackupData[T][number]

export const g = (n: number) => testGid(n)

export function emptyLedger(): BackupData {
  return {
    settings: [],
    itemGroups: [],
    items: [],
    customers: [],
    customerPrices: [],
    orders: [],
    orderLines: [],
    payments: [],
    expenseCategories: [],
    expenses: [],
  }
}

export const mk = {
  group: (id: number, gid: number, over: Partial<Row<'itemGroups'>> = {}): Row<'itemGroups'> => ({
    id, gid: g(gid), name: `Nhóm ${gid}`, sortOrder: 1, optionGroups: [], toppingMenu: [], createdAt: 1, updatedAt: 1, ...over,
  }),
  item: (id: number, gid: number, over: Partial<Row<'items'>> = {}): Row<'items'> => ({
    id, gid: g(gid), name: `Món ${gid}`, groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1, note: '', createdAt: 1, updatedAt: 1, ...over,
  }),
  customer: (id: number, gid: number, over: Partial<Row<'customers'>> = {}): Row<'customers'> => ({
    id, gid: g(gid), name: `Khách ${gid}`, phone: '', address: '', note: '', createdAt: 1, updatedAt: 1, ...over,
  }),
  price: (id: number, gid: number, customerId: number, itemId: number, over: Partial<Row<'customerPrices'>> = {}): Row<'customerPrices'> => ({
    id, gid: g(gid), customerId, itemId, unitPrice: 45_000, createdAt: 1, updatedAt: 1, ...over,
  }),
  order: (id: number, gid: number, total: number, over: Partial<Order> = {}): Row<'orders'> => ({
    id, gid: g(gid), code: `PBH-261001-A${String(id).padStart(3, '0')}`, originalCode: '', customerId: 1, customerName: 'Khách',
    subtotal: total, discount: 0, surcharge: 0, total, paidAmount: 0, status: 'unpaid', soldAt: at + id, note: '', createdAt: 1, updatedAt: 1, ...over,
  }),
  line: (id: number, gid: number, orderId: number, amount: number, over: Partial<Row<'orderLines'>> = {}): Row<'orderLines'> => ({
    id, gid: g(gid), orderId, itemId: null, name: 'Phở', unit: 'tô', unitPrice: amount, costPrice: null, qty: 1, amount, note: '', options: [], toppings: [], ...over,
  }),
  payment: (id: number, gid: number, orderId: number, amount: number, over: Partial<Payment> = {}): Row<'payments'> => ({
    id, gid: g(gid), orderId, allocatedOrderId: orderId, customerId: 1, amount, method: 'cash', paidAt: at + id, note: '', ...over,
  }),
  category: (id: number, gid: number, over: Partial<Row<'expenseCategories'>> = {}): Row<'expenseCategories'> => ({
    id, gid: g(gid), name: `Loại ${gid}`, createdAt: 1, updatedAt: 1, ...over,
  }),
  expense: (id: number, gid: number, categoryId: number | null, amount: number, over: Partial<Row<'expenses'>> = {}): Row<'expenses'> => ({
    id, gid: g(gid), categoryId, amount, note: '', spentAt: at, createdAt: 1, updatedAt: 1, ...over,
  }),
}

/**
 * Cùng một sổ nhưng mọi id cục bộ dịch đi `offset` — như bản sao của chính sổ đó được nạp ở máy khác
 * rồi đánh số lại. Gộp theo gid phải coi hai bản này là một.
 */
export function shiftIds(data: BackupData, offset: number): BackupData {
  const s = (id: number) => id + offset
  const sn = (id: number | null) => (id === null ? null : s(id))
  return {
    settings: data.settings.map((row) => ({ ...row })),
    itemGroups: data.itemGroups.map((row) => ({ ...row, id: s(row.id) })),
    items: data.items.map((row) => ({ ...row, id: s(row.id), groupId: sn(row.groupId) })),
    customers: data.customers.map((row) => ({ ...row, id: s(row.id) })),
    customerPrices: data.customerPrices.map((row) => ({ ...row, id: s(row.id), customerId: s(row.customerId), itemId: s(row.itemId) })),
    orders: data.orders.map((row) => ({ ...row, id: s(row.id), customerId: sn(row.customerId) })),
    orderLines: data.orderLines.map((row) => ({ ...row, id: s(row.id), orderId: s(row.orderId), itemId: sn(row.itemId) })),
    payments: data.payments.map((row) => ({
      ...row,
      id: s(row.id),
      orderId: s(row.orderId),
      allocatedOrderId: row.allocatedOrderId === 0 ? 0 : s(row.allocatedOrderId),
      customerId: sn(row.customerId),
    })),
    expenseCategories: data.expenseCategories.map((row) => ({ ...row, id: s(row.id) })),
    expenses: data.expenses.map((row) => ({ ...row, id: s(row.id), categoryId: sn(row.categoryId) })),
  }
}

/**
 * Sổ của khách K (id 1) với nợ đơn đủ lớn hơn mọi khoản chưa trừ, để `groupDebts` không kẹp về 0:
 * - đơn 1 nợ 500k; đơn 4 tổng 100k đã thu 60k (khoản 3) ⇒ nợ đơn 540k
 * - đơn 2, 3 đã huỷ; khoản 1 (30k) và khoản 2 (20k) là tiền thu của chúng, nay chưa trừ đơn nào
 * - nợ K = 540k − 30k − 20k = 490k
 */
export function ledgerK(): BackupData {
  return {
    ...emptyLedger(),
    settings: [{ key: 'app', value: { lastBackupAt: null, seededExpenseCategories: true } }],
    itemGroups: [mk.group(1, 1)],
    items: [mk.item(1, 2, { groupId: 1 })],
    customers: [mk.customer(1, 3, { name: 'Chị Hoa' })],
    customerPrices: [mk.price(1, 4, 1, 1)],
    orders: [
      mk.order(1, 10, 500_000),
      mk.order(2, 11, 30_000, { status: 'void' }),
      mk.order(3, 12, 20_000, { status: 'void' }),
      mk.order(4, 13, 100_000, { paidAmount: 60_000, status: 'partial' }),
    ],
    orderLines: [
      mk.line(1, 30, 1, 500_000, { itemId: 1 }),
      mk.line(2, 31, 2, 30_000),
      mk.line(3, 32, 3, 20_000),
      mk.line(4, 33, 4, 100_000),
    ],
    payments: [
      mk.payment(1, 20, 2, 30_000, { allocatedOrderId: 0 }),
      mk.payment(2, 21, 3, 20_000, { allocatedOrderId: 0 }),
      mk.payment(3, 22, 4, 60_000),
    ],
    expenseCategories: [mk.category(1, 40, { name: 'Chợ' })],
    expenses: [mk.expense(1, 41, 1, 15_000)],
  }
}
