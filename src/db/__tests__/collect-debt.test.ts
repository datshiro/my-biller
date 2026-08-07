import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCustomer } from '../repositories/customers'
import { createOrder, listOpenDebtOrders, summarizeDebt, voidOrder } from '../repositories/orders'
import { collectDebt, listCustomerPayments } from '../repositories/payments'
import { groupDebts, totalDebt } from '@/domain/debt'

const day = (date: number) => new Date(2026, 7, date, 10, 0).getTime()

let customerId: number

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
})

/** Bán nợ toàn bộ: không kèm phiếu thu nào. */
async function sellOnCredit(soldAt: number, amount: number) {
  return createOrder({
    customerId,
    customerName: 'Chị Hoa',
    lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: amount, costPrice: null, qty: 1 }],
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: null,
  })
}

/** Bất biến toàn hệ thống: tiền đã thu của đơn luôn đúng bằng tổng phiếu thu của đơn đó. */
async function expectPaymentsMatchOrders() {
  const [orders, payments] = await Promise.all([db.orders.toArray(), db.payments.toArray()])
  const byOrder = new Map<number, number>()
  for (const payment of payments) {
    byOrder.set(payment.orderId, (byOrder.get(payment.orderId) ?? 0) + payment.amount)
  }
  for (const order of orders) {
    expect([order.code, order.paidAmount]).toEqual([order.code, byOrder.get(order.id ?? -1) ?? 0])
  }
}

const collect = (amount: number) =>
  collectDebt({ customerId, amount, method: 'cash', paidAt: day(9), note: '' })

describe('thu nợ', () => {
  it('trừ đơn cũ nhất trước, mỗi đơn một dòng lịch sử riêng', async () => {
    await sellOnCredit(day(1), 100_000)
    await sellOnCredit(day(2), 200_000)
    await sellOnCredit(day(3), 150_000)

    await collect(250_000)

    const orders = await db.orders.orderBy('soldAt').toArray()
    expect(orders.map((order) => [order.status, order.paidAmount])).toEqual([
      ['paid', 100_000],
      ['partial', 150_000],
      ['unpaid', 0],
    ])
    expect(totalDebt(groupDebts(await listOpenDebtOrders()))).toBe(200_000)

    // Thu một lần 250k nhưng nằm ở 2 đơn → 2 dòng, không phải 1 dòng gộp.
    const payments = await listCustomerPayments(customerId)
    expect(payments.map((payment) => payment.amount)).toEqual([150_000, 100_000])
    await expectPaymentsMatchOrders()
  })

  it('thu đúng tổng nợ → khách biến mất khỏi danh sách nợ', async () => {
    await sellOnCredit(day(1), 100_000)
    await sellOnCredit(day(2), 200_000)

    await collect(300_000)

    expect(await summarizeDebt()).toEqual({ total: 0, customerCount: 0 })
    expect((await db.orders.toArray()).every((order) => order.status === 'paid')).toBe(true)
    await expectPaymentsMatchOrders()
  })

  it('thu quá tổng nợ bị chặn và DB không đổi', async () => {
    await sellOnCredit(day(1), 100_000)
    await sellOnCredit(day(2), 200_000)

    await expect(collect(300_001)).rejects.toThrow(/chỉ còn nợ 300\.000 đ/)

    // Rollback: đơn đầu tiên đã được phân bổ trong cùng transaction, không được giữ lại phần đó.
    expect(await db.payments.count()).toBe(0)
    expect((await db.orders.toArray()).map((order) => order.paidAmount)).toEqual([0, 0])
    expect((await summarizeDebt()).total).toBe(300_000)
  })

  it('thu nhiều lần dồn lại: mỗi lần là một dòng, tổng nợ giảm dần', async () => {
    await sellOnCredit(day(1), 300_000)

    await collect(100_000)
    await collect(50_000)

    expect((await db.orders.toArray())[0]?.status).toBe('partial')
    expect((await listCustomerPayments(customerId)).length).toBe(2)
    expect((await summarizeDebt()).total).toBe(150_000)
    await expectPaymentsMatchOrders()
  })

  it('đơn đã huỷ không còn nợ và không nhận tiền thu', async () => {
    const cancelled = await sellOnCredit(day(1), 100_000)
    await sellOnCredit(day(2), 200_000)
    await voidOrder(cancelled.id)

    expect((await summarizeDebt()).total).toBe(200_000)

    await collect(200_000)

    expect(await db.payments.where('orderId').equals(cancelled.id).count()).toBe(0)
    expect((await summarizeDebt()).total).toBe(0)
  })

  it('thu quá số còn nợ vì đơn vừa bị huỷ → chặn, không tràn sang đơn khác', async () => {
    const cancelled = await sellOnCredit(day(1), 100_000)
    await sellOnCredit(day(2), 200_000)
    await voidOrder(cancelled.id)

    await expect(collect(300_000)).rejects.toThrow(/chỉ còn nợ 200\.000 đ/)
    expect(await db.payments.count()).toBe(0)
  })

  it('tổng nợ của khách không tính đơn khách khác', async () => {
    const other = await createCustomer({ name: 'Anh Ba', phone: '', address: '', note: '' })
    await sellOnCredit(day(1), 100_000)
    await createOrder({
      customerId: other,
      customerName: 'Anh Ba',
      lines: [{ itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 500_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: day(1),
      note: '',
      payment: null,
    })

    await expect(collect(150_000)).rejects.toThrow(/chỉ còn nợ 100\.000 đ/)

    const groups = groupDebts(await listOpenDebtOrders())
    expect(groups.map((group) => group.total).sort((a, b) => a - b)).toEqual([100_000, 500_000])
    expect((await summarizeDebt()).customerCount).toBe(2)
  })
})
