import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  createOrder,
  getOrderLines,
  listOrdersOfDay,
  voidOrder,
  type OrderDraft,
} from '../repositories/orders'
import { aggregateRevenue } from '@/domain/report'
import { remainingOf } from '@/domain/order-status'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()

const draft = (overrides: Partial<OrderDraft> = {}): OrderDraft => ({
  customerId: 1,
  customerName: 'Anh Hùng',
  lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 }],
  discount: 0,
  surcharge: 0,
  soldAt,
  note: '',
  payment: null,
  ...overrides,
})

/** Công nợ của một khách = phần chưa trả của các đơn CHƯA huỷ. */
async function debtOf(customerId: number): Promise<number> {
  const orders = await db.orders.where('customerId').equals(customerId).toArray()
  return orders
    .filter((order) => order.status !== 'void')
    .reduce((sum, order) => sum + remainingOf(order.total, order.paidAmount), 0)
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('voidOrder', () => {
  it('doanh thu ngày giảm đúng số tiền của đơn bị huỷ', async () => {
    await createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))
    const second = await createOrder(
      draft({
        lines: [{ itemId: null, name: 'Cơm tấm', unit: 'đĩa', unitPrice: 45_000, costPrice: 24_000, qty: 1 }],
        payment: { amount: 45_000, method: 'cash', note: '' },
      }),
    )
    expect(aggregateRevenue(await listOrdersOfDay(soldAt))).toBe(155_000)

    await voidOrder(second.id)

    expect(aggregateRevenue(await listOrdersOfDay(soldAt))).toBe(110_000)
  })

  it('công nợ của khách giảm đúng phần còn thiếu của đơn bị huỷ', async () => {
    await createOrder(draft({ payment: { amount: 40_000, method: 'cash', note: '' } }))
    const debtOrder = await createOrder(draft())
    expect(await debtOf(1)).toBe(70_000 + 110_000)

    await voidOrder(debtOrder.id)

    expect(await debtOf(1)).toBe(70_000)
  })

  it('xoá sạch phiếu thu của đơn và đưa paidAmount về 0', async () => {
    const { id } = await createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))

    await voidOrder(id)

    expect(await db.orders.get(id)).toMatchObject({ status: 'void', paidAmount: 0 })
    expect(await db.payments.where('orderId').equals(id).count()).toBe(0)
  })

  it('giữ lại đơn và dòng hàng — số phiếu đã đưa khách không được dùng lại cho đơn khác', async () => {
    const { id, code } = await createOrder(draft())

    await voidOrder(id)

    expect((await db.orders.get(id))?.code).toBe(code)
    expect(await getOrderLines(id)).toHaveLength(1)

    const next = await createOrder(draft())
    expect((await db.orders.get(next.id))?.code).not.toBe(code)
  })

  it('huỷ hai lần không làm hỏng gì', async () => {
    const { id } = await createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))

    await voidOrder(id)
    await voidOrder(id)

    expect(await db.orders.get(id)).toMatchObject({ status: 'void', paidAmount: 0 })
  })

  it('huỷ đơn không tồn tại thì báo lỗi thay vì im lặng', async () => {
    await expect(voidOrder(999)).rejects.toThrow('Không tìm thấy đơn')
  })
})
