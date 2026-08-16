import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { recalcAll } from '../recalc'
import {
  addOrderPayment,
  listUnallocatedPayments,
  resolveUnallocatedPayment,
} from '../repositories/payments'
import { createOrder, type OrderDraft } from '../repositories/orders'
import { installTestDevice } from '@/test-fixtures'

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
    const payments = await db.payments.where('allocatedOrderId').equals(order.id ?? -1).toArray()
    const sum = payments.reduce((total, payment) => total + payment.amount, 0)
    expect({ code: order.code, paidAmount: order.paidAmount }).toEqual({ code: order.code, paidAmount: sum })
  }
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
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

describe('xử lý khoản thu chưa gắn đơn', () => {
  async function makeUnallocatedPayment() {
    const { id } = await createOrder(
      draft(100_000, 1, { payment: { amount: 40_000, method: 'cash', note: '' } }),
    )
    const payment = await db.payments.where('allocatedOrderId').equals(id).first()
    await db.transaction('rw', db.orders, db.payments, async () => {
      await db.payments.update(payment!.id!, { allocatedOrderId: 0 })
      await db.orders.update(id, { paidAmount: 0, status: 'unpaid' })
    })
    return { orderId: id, paymentId: payment!.id! }
  }

  it('gắn lại đúng đơn và cập nhật tổng đã thu trong cùng transaction', async () => {
    const { orderId, paymentId } = await makeUnallocatedPayment()

    await resolveUnallocatedPayment(paymentId, { kind: 'allocate', orderId })

    expect(await db.payments.get(paymentId)).toMatchObject({
      allocatedOrderId: orderId,
      resolutionNote: expect.stringContaining('PBH-'),
    })
    expect(await db.orders.get(orderId)).toMatchObject({ paidAmount: 40_000, status: 'partial' })
    expect(await listUnallocatedPayments()).toHaveLength(0)
    await assertPaidAmountMatchesPayments()
  })

  it.each(['refunded', 'discarded'] as const)(
    'giữ phiếu thu và dấu vết khi đánh dấu %s',
    async (kind) => {
      const { paymentId } = await makeUnallocatedPayment()

      await resolveUnallocatedPayment(paymentId, { kind, reason: 'Đối chiếu cuối ca' })

      expect(await db.payments.get(paymentId)).toMatchObject({
        allocatedOrderId: 0,
        amount: 40_000,
        unallocatedStatus: kind,
        resolutionNote: 'Đối chiếu cuối ca',
      })
      expect(await listUnallocatedPayments()).toHaveLength(0)
    },
  )

  it('không cho tiền rời hàng chờ mà thiếu lý do kiểm toán', async () => {
    const { paymentId } = await makeUnallocatedPayment()

    await expect(
      resolveUnallocatedPayment(paymentId, { kind: 'refunded', reason: '   ' }),
    ).rejects.toThrow(/Phải ghi lý do/)
    expect(await listUnallocatedPayments()).toHaveLength(1)
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

    await recalcAll()
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

  /**
   * Đưa `paidAmount` về 0 mà để dòng `payments` nằm lại là bất biến gãy ở chỗ không màn nào kêu: chi
   * tiết đơn đọc `paidAmount` nên hiện đúng, còn lịch sử thu tiền của khách và tổng "Đã thu" của kỳ
   * thì đọc thẳng bảng `payments` nên vẫn cộng số tiền đó vào.
   */
  it('đơn huỷ giữ phiếu thu nhưng bỏ phân bổ, không chỉ đưa tổng về 0', async () => {
    const { id } = await createOrder(draft(100_000, 1, { payment: { amount: 100_000, method: 'cash', note: '' } }))
    await db.orders.update(id, { status: 'void' })

    expect(await recalcAll()).toBe(1)

    expect(await db.orders.get(id)).toMatchObject({ status: 'void', paidAmount: 0 })
    expect(await db.payments.where('orderId').equals(id).toArray()).toMatchObject([
      { amount: 100_000, allocatedOrderId: 0 },
    ])
    await assertPaidAmountMatchesPayments()
  })

  /**
   * Ca này bắt đúng cái bẫy: `repaired` trả `null` khi dòng đơn đã đúng, nên nếu việc dọn phiếu thu
   * đi kèm với việc sửa dòng đơn thì đơn đã recalc một lần rồi sẽ không bao giờ được dọn nữa.
   */
  it('đơn huỷ đã đúng tổng nhưng còn phân bổ phiếu thu thì vẫn được gỡ', async () => {
    const { id } = await createOrder(draft(100_000, 1, { payment: { amount: 100_000, method: 'cash', note: '' } }))
    expect((await db.payments.where('orderId').equals(id).first())?.allocatedOrderId).toBe(id)
    await db.orders.update(id, { status: 'void', paidAmount: 0 })

    expect(await recalcAll()).toBe(1)
    expect(await db.payments.where('orderId').equals(id).toArray()).toMatchObject([
      { allocatedOrderId: 0 },
    ])

    // Dọn xong thì hết việc — chạy lại không được đếm khống.
    expect(await recalcAll()).toBe(0)
  })
})
