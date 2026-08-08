import { db } from '../db'
import { deleteByCustomer } from './customer-prices'
import { matchesCustomer } from '@/domain/customer-search'
import { remainingOf } from '@/domain/order-status'
import { CustomerSchema, type Customer } from '@/domain/schema'

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>

const now = () => Date.now()

export function listCustomers(): Promise<Customer[]> {
  return db.customers.orderBy('name').toArray()
}

export function getCustomer(id: number): Promise<Customer | undefined> {
  return db.customers.get(id)
}

export async function searchCustomers(keyword: string): Promise<Customer[]> {
  const all = await listCustomers()
  return all.filter((customer) => matchesCustomer(customer, keyword))
}

export function createCustomer(input: CustomerInput): Promise<number> {
  const stamp = now()
  return db.customers.add(CustomerSchema.parse({ ...input, createdAt: stamp, updatedAt: stamp }))
}

export async function updateCustomer(id: number, patch: Partial<CustomerInput>): Promise<void> {
  const current = await db.customers.get(id)
  if (!current) throw new Error(`Không tìm thấy khách hàng #${id}`)
  await db.customers.put(CustomerSchema.parse({ ...current, ...patch, id, updatedAt: now() }))
}

export type CustomerSummary = { orderCount: number; lastSoldAt: number | null; debt: number }

/**
 * Gộp một lượt qua bảng đơn để ra số đơn / lần mua gần nhất / còn nợ của từng khách.
 * Đơn đã huỷ không tính vào cả ba con số.
 */
export async function summarizeCustomers(): Promise<Map<number, CustomerSummary>> {
  const summaries = new Map<number, CustomerSummary>()

  await db.orders.each((order) => {
    if (order.customerId === null || order.status === 'void') return

    const current = summaries.get(order.customerId) ?? { orderCount: 0, lastSoldAt: null, debt: 0 }
    current.orderCount += 1
    current.lastSoldAt = Math.max(current.lastSoldAt ?? 0, order.soldAt)
    current.debt += remainingOf(order.total, order.paidAmount)
    summaries.set(order.customerId, current)
  })

  return summaries
}

export function countOrdersOfCustomer(id: number): Promise<number> {
  return db.orders.where('customerId').equals(id).count()
}

/** Từ chối xoá khi khách còn đơn: xoá đi thì công nợ và lịch sử mua mất chủ, không phục hồi được. */
export async function deleteCustomer(id: number): Promise<void> {
  const orderCount = await countOrdersOfCustomer(id)
  if (orderCount > 0) {
    throw new Error(`Khách hàng này đã có ${orderCount} đơn — không xoá được. Hãy sửa thông tin thay vì xoá.`)
  }
  await db.transaction('rw', db.customers, db.customerPrices, async () => {
    await deleteByCustomer(id)
    await db.customers.delete(id)
  })
}
