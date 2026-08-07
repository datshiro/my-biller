import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createItem, getItem, updateItem } from '../repositories/items'
import { createOrder, getOrderLines, getOrderPayments, type OrderDraft } from '../repositories/orders'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()

// Mặc định gắn khách: phần lớn ca thử ở đây để đơn còn nợ, mà nợ thì bắt buộc có chủ.
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

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('createOrder', () => {
  it('ghi đơn + dòng hàng + phiếu thu, tính đúng tổng và trạng thái', async () => {
    const { id, code } = await createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))

    const order = await db.orders.get(id)
    expect(code).toBe('PBH-260807-001')
    expect(order).toMatchObject({ subtotal: 110_000, total: 110_000, paidAmount: 110_000, status: 'paid' })
    expect(await getOrderLines(id)).toHaveLength(1)
    expect(await getOrderPayments(id)).toHaveLength(1)
  })

  it('trả một phần → partial, không trả → unpaid', async () => {
    const partial = await createOrder(draft({ payment: { amount: 50_000, method: 'cash', note: '' } }))
    const unpaid = await createOrder(draft())

    expect((await db.orders.get(partial.id))?.status).toBe('partial')
    expect((await db.orders.get(unpaid.id))?.status).toBe('unpaid')
    expect((await db.orders.get(unpaid.id))?.paidAmount).toBe(0)
  })

  it('kẹp giảm giá ở mức tiền hàng', async () => {
    const { id } = await createOrder(draft({ discount: 999_000 }))
    expect(await db.orders.get(id)).toMatchObject({ discount: 110_000, total: 0, status: 'paid' })
  })

  it('sửa giá mặt hàng KHÔNG làm sai phiếu đã xuất', async () => {
    const itemId = await createItem({
      name: 'Phở bò',
      groupId: null,
      unit: 'tô',
      unitPrice: 55_000,
      costPrice: 30_000,
      isActive: 1,
    })
    const { id } = await createOrder(
      draft({ lines: [{ itemId, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 }] }),
    )

    await updateItem(itemId, { unitPrice: 70_000, name: 'Phở bò (mới)' })

    expect((await getItem(itemId))?.unitPrice).toBe(70_000)
    expect((await getOrderLines(id))[0]).toMatchObject({ name: 'Phở bò', unitPrice: 55_000, amount: 110_000 })
    expect((await db.orders.get(id))?.total).toBe(110_000)
  })

  it('trả dư thì từ chối VÀ rollback — không để lại đơn mồ côi', async () => {
    await expect(
      createOrder(draft({ payment: { amount: 200_000, method: 'cash', note: '' } })),
    ).rejects.toThrow(/lớn hơn tổng đơn/)

    expect(await db.orders.count()).toBe(0)
    expect(await db.orderLines.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
  })

  it('chặn số tiền lẻ đồng ngay tại cửa ngõ ghi DB', async () => {
    await expect(
      createOrder(
        draft({ lines: [{ itemId: null, name: 'Phở', unit: 'tô', unitPrice: 55_000.5, costPrice: null, qty: 1 }] }),
      ),
    ).rejects.toThrow(/số nguyên/)

    expect(await db.orders.count()).toBe(0)
  })

  it('từ chối đơn không có mặt hàng nào', async () => {
    await expect(createOrder(draft({ lines: [] }))).rejects.toThrow(/ít nhất một mặt hàng/)
  })

  it('từ chối ghi nợ cho khách lẻ — nợ phải có chủ', async () => {
    const khachLe = { customerId: null, customerName: 'Khách lẻ' }

    await expect(createOrder(draft(khachLe))).rejects.toThrow(/khách hàng cụ thể/)
    await expect(
      createOrder(draft({ ...khachLe, payment: { amount: 50_000, method: 'cash', note: '' } })),
    ).rejects.toThrow(/khách hàng cụ thể/)

    expect(await db.orders.count()).toBe(0)
  })

  it('khách lẻ trả đủ vẫn bán bình thường', async () => {
    const { id } = await createOrder(
      draft({
        customerId: null,
        customerName: 'Khách lẻ',
        payment: { amount: 110_000, method: 'cash', note: '' },
      }),
    )

    expect(await db.orders.get(id)).toMatchObject({ customerId: null, status: 'paid' })
  })

  it('300 đơn trong cùng một ngày: mã không trùng, đánh số 001..300', async () => {
    for (let i = 0; i < 300; i += 1) {
      await createOrder(draft({ soldAt: soldAt + i * 1_000 }))
    }

    const codes = (await db.orders.toArray()).map((order) => order.code).sort()
    expect(codes).toHaveLength(300)
    expect(new Set(codes).size).toBe(300)
    expect(codes[0]).toBe('PBH-260807-001')
    expect(codes.at(-1)).toBe('PBH-260807-300')
  }, 60_000)

  it('sang ngày mới thì số phiếu quay về 001', async () => {
    await createOrder(draft())
    const next = await createOrder(draft({ soldAt: new Date(2026, 7, 8, 9, 0).getTime() }))
    expect((await db.orders.get(next.id))?.code).toBe('PBH-260808-001')
  })
})
