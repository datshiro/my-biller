import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { recalcAll, recalcOrderPayment } from '../recalc'
import { addOrderPayment } from '../repositories/payments'
import { createOrder, type OrderDraft } from '../repositories/orders'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()

// Cả file này xoay quanh đơn còn nợ, mà nợ thì bắt buộc có chủ — nên mặc định gắn khách.
const draft = (unitPrice: number, qty = 1, overrides: Partial<OrderDraft> = {}): OrderDraft => ({
  customerId: 1,
  customerName: 'Anh Hùng',
  lines: [{ itemId: null, name: 'Hàng', unit: 'cái', unitPrice, costPrice: null, qty }],
  discount: 0,
  surcharge: 0,
  soldAt,
  note: '',
  payment: null,
  ...overrides,
})

/** Bất biến của toàn hệ thống: với mọi đơn, paidAmount phải bằng đúng tổng các phiếu thu của đơn đó. */
async function assertPaidAmountMatchesPayments() {
  const orders = await db.orders.toArray()
  for (const order of orders) {
    const payments = await db.payments.where('orderId').equals(order.id ?? -1).toArray()
    const sum = payments.reduce((total, payment) => total + payment.amount, 0)
    expect({ code: order.code, paidAmount: order.paidAmount }).toEqual({ code: order.code, paidAmount: sum })
  }
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('addOrderPayment', () => {
  it('cộng dồn tiền thu và cập nhật trạng thái trong cùng transaction', async () => {
    const { id } = await createOrder(draft(100_000))

    await addOrderPayment({ orderId: id, amount: 40_000, method: 'cash', paidAt: soldAt, note: '' })
    expect(await db.orders.get(id)).toMatchObject({ paidAmount: 40_000, status: 'partial' })

    await addOrderPayment({ orderId: id, amount: 60_000, method: 'transfer', paidAt: soldAt, note: '' })
    expect(await db.orders.get(id)).toMatchObject({ paidAmount: 100_000, status: 'paid' })

    await assertPaidAmountMatchesPayments()
  })

  it('từ chối thu vượt số còn nợ và không ghi phiếu thu nào', async () => {
    const { id } = await createOrder(draft(100_000, 1, { payment: { amount: 90_000, method: 'cash', note: '' } }))

    await expect(
      addOrderPayment({ orderId: id, amount: 20_000, method: 'cash', paidAt: soldAt, note: '' }),
    ).rejects.toThrow(/vượt số còn nợ/)

    expect((await db.payments.where('orderId').equals(id).toArray())).toHaveLength(1)
    await assertPaidAmountMatchesPayments()
  })

  it('không thu được trên đơn đã huỷ', async () => {
    const { id } = await createOrder(draft(100_000))
    await db.orders.update(id, { status: 'void' })

    await expect(
      addOrderPayment({ orderId: id, amount: 10_000, method: 'cash', paidAt: soldAt, note: '' }),
    ).rejects.toThrow(/đã huỷ/)
  })

  it('từ chối số tiền 0 hoặc âm bằng câu người bán đọc được, không phải lỗi thô của zod', async () => {
    const { id } = await createOrder(draft(100_000))
    for (const amount of [0, -1000]) {
      await expect(
        addOrderPayment({ orderId: id, amount, method: 'cash', paidAt: soldAt, note: '' }),
      ).rejects.toThrow('Số tiền thu phải lớn hơn 0.')
    }
  })
})

describe('bất biến paidAmount trên dữ liệu sinh hàng loạt', () => {
  it('giữ đúng qua 60 đơn với đủ kiểu trả trước / trả góp / ghi nợ', async () => {
    for (let i = 0; i < 60; i += 1) {
      const total = 10_000 * (i + 1)
      const upfront = i % 3 === 0 ? total : i % 3 === 1 ? Math.round(total / 2) : 0
      const { id } = await createOrder(
        draft(total, 1, {
          soldAt: soldAt + i * 1_000,
          payment: upfront > 0 ? { amount: upfront, method: 'cash', note: '' } : null,
        }),
      )

      if (i % 5 === 0 && upfront < total) {
        await addOrderPayment({ orderId: id, amount: 10_000, method: 'transfer', paidAt: soldAt, note: '' })
      }
    }

    expect(await db.orders.count()).toBe(60)
    await assertPaidAmountMatchesPayments()
  }, 30_000)
})

describe('recalc', () => {
  it('sửa lại đơn bị lệch (mô phỏng dữ liệu nhập từ file sao lưu)', async () => {
    const { id } = await createOrder(draft(100_000, 1, { payment: { amount: 30_000, method: 'cash', note: '' } }))
    await db.orders.update(id, { paidAmount: 0, status: 'unpaid' })

    await recalcOrderPayment(id)
    expect(await db.orders.get(id)).toMatchObject({ paidAmount: 30_000, status: 'partial' })
  })

  it('recalcAll chỉ đếm những đơn thực sự phải sửa', async () => {
    const bad = await createOrder(draft(100_000, 1, { payment: { amount: 100_000, method: 'cash', note: '' } }))
    await createOrder(draft(50_000, 1, { soldAt: soldAt + 1_000, payment: { amount: 50_000, method: 'cash', note: '' } }))
    await db.orders.update(bad.id, { paidAmount: 1, status: 'partial' })

    expect(await recalcAll()).toBe(1)
    expect(await recalcAll()).toBe(0)
    await assertPaidAmountMatchesPayments()
  })

  it('không hồi sinh đơn đã huỷ', async () => {
    const { id } = await createOrder(draft(100_000, 1, { payment: { amount: 100_000, method: 'cash', note: '' } }))
    await db.orders.update(id, { status: 'void' })

    await recalcAll()
    expect((await db.orders.get(id))?.status).toBe('void')
  })
})
