import type { BackupData } from '../schema'
import { testGid } from '@/test-fixtures'

const at = new Date(2026, 7, 9, 10).getTime()
const settings: BackupData['settings'] = []

const group = (gid: number) => ({ id: 1, gid: testGid(gid), name: 'Món', sortOrder: 1, createdAt: 1, updatedAt: 1 })
const item = (gid: number) => ({ id: 1, gid: testGid(gid), name: 'Phở', groupId: 1, unit: 'tô', unitPrice: 50_000, costPrice: 20_000, isActive: 1 as const, note: '', createdAt: 1, updatedAt: 1 })
const customer = (gid: number) => ({ id: 1, gid: testGid(gid), name: 'Chị Hoa', phone: gid === 101 ? '0901' : '0902', address: '', note: '', createdAt: 1, updatedAt: 1 })
const price = (gid: number) => ({ id: 1, gid: testGid(gid), customerId: 1, itemId: 1, unitPrice: 45_000, createdAt: 1, updatedAt: 1 })
const category = (gid: number) => ({ id: 1, gid: testGid(gid), name: 'Chợ', createdAt: 1, updatedAt: 1 })
const expense = (gid: number, amount: number) => ({ id: 1, gid: testGid(gid), categoryId: 1, amount, note: '', spentAt: at, createdAt: 1, updatedAt: 1 })

const order = (id: number, gid: number, code: string, total: number, paidAmount: number, status: 'paid' | 'unpaid' | 'void') => ({
  id,
  gid: testGid(gid),
  code,
  originalCode: '',
  customerId: 1,
  customerName: 'Chị Hoa',
  subtotal: total,
  discount: 0,
  surcharge: 0,
  total,
  paidAmount,
  status,
  soldAt: at + id,
  note: '',
  createdAt: 1,
  updatedAt: 1,
})
const line = (id: number, gid: number, orderId: number, amount: number) => ({ id, gid: testGid(gid), orderId, itemId: 1, name: 'Phở', unit: 'tô', unitPrice: amount, costPrice: 20_000, qty: 1, amount })
const payment = (id: number, gid: number, orderId: number, amount: number, allocatedOrderId: number) => ({ id, gid: testGid(gid), orderId, allocatedOrderId, customerId: 1, amount, method: 'cash' as const, paidAt: at + id, note: '' })

export const ledgerA: BackupData = {
  settings,
  itemGroups: [group(11)],
  items: [item(21)],
  customers: [customer(101)],
  customerPrices: [price(31)],
  orders: [
    order(1, 41, 'PBH-260809-001', 100_000, 0, 'unpaid'),
    order(2, 42, 'PBH-260809-002', 50_000, 50_000, 'paid'),
  ],
  orderLines: [line(1, 51, 1, 100_000), line(2, 52, 2, 50_000)],
  payments: [payment(1, 61, 2, 50_000, 2)],
  expenseCategories: [category(71)],
  expenses: [expense(81, 10_000)],
}

export const ledgerB: BackupData = {
  settings,
  itemGroups: [group(12)],
  items: [item(22)],
  customers: [customer(102)],
  customerPrices: [price(32)],
  orders: [
    order(1, 43, 'PBH-260809-001', 70_000, 70_000, 'paid'),
    order(2, 44, 'PBH-260809-002', 30_000, 0, 'unpaid'),
    order(3, 45, 'PBH-260809-B001', 20_000, 0, 'void'),
  ],
  orderLines: [line(1, 53, 1, 70_000), line(2, 54, 2, 30_000), line(3, 55, 3, 20_000)],
  payments: [payment(1, 62, 1, 70_000, 1), payment(2, 63, 3, 20_000, 0)],
  expenseCategories: [category(72)],
  expenses: [expense(82, 15_000)],
}
