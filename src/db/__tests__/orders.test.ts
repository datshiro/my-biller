import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createItem, getItem, updateItem } from '../repositories/items'
import {
  createOrder,
  getOrderLines,
  getOrderPayments,
  listOrderLinesOfOrders,
  listOrdersByCustomer,
  listPaymentsBetween,
  type OrderDraft,
  voidOrder,
} from '../repositories/orders'
import { resolveUnallocatedPayment } from '../repositories/payments'
import { installTestDevice, testGid } from '@/test-fixtures'

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
  await installTestDevice()
})

describe('createOrder', () => {
  it('ghi đơn + dòng hàng + phiếu thu, tính đúng tổng và trạng thái', async () => {
    const { id, code } = await createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))

    const order = await db.orders.get(id)
    expect(code).toBe('PBH-260807-A001')
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

  /**
   * Khác ca dưới ở chỗ giá trong draft **đã** khác giá danh mục ngay lúc ghi. Ca dưới chỉ chứng minh
   * "bản ghi đã lưu không bị viết đè ngược"; ca này chứng minh `createOrder` chép giá từ draft chứ
   * không tra lại bảng `items` — nếu nó tra lại thì giá vốn hôm nay sẽ chảy ngược vào đơn cũ và làm
   * sai lợi nhuận của mọi kỳ đã chốt.
   */
  it('giá bán và giá vốn ghi vào dòng đơn là số trong draft, không phải số đang có trong danh mục', async () => {
    const itemId = await createItem({
      name: 'Phở bò',
      groupId: null,
      unit: 'tô',
      unitPrice: 55_000,
      costPrice: 30_000,
      isActive: 1,
    })

    const { id } = await createOrder(
      draft({ lines: [{ itemId, name: 'Phở bò hôm qua', unit: 'tô', unitPrice: 50_000, costPrice: 25_000, qty: 2 }] }),
    )

    expect((await getOrderLines(id))[0]).toMatchObject({
      itemId,
      name: 'Phở bò hôm qua',
      unitPrice: 50_000,
      costPrice: 25_000,
      amount: 100_000,
    })
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

  it('khoản thu khách lẻ đã hoàn không còn đi vào nguồn “Đã thu” của báo cáo', async () => {
    const { id } = await createOrder(
      draft({
        customerId: null,
        customerName: 'Khách lẻ',
        payment: { amount: 110_000, method: 'cash', note: '' },
      }),
    )
    await voidOrder(id)
    const payment = await db.payments.where('orderId').equals(id).first()
    expect(payment?.id).toBeDefined()

    await resolveUnallocatedPayment(payment?.id ?? 0, {
      kind: 'refunded',
      reason: 'Đã trả lại khách.',
    })

    expect(await listPaymentsBetween(soldAt - 1, soldAt + 1)).toEqual([])
  })

  /** Bấm XONG hai lần bằng hai ngón, hoặc màn hình đơ rồi nhả một lượt — hai lệnh ghi cùng lúc thật. */
  it('20 đơn ghi đồng thời: không đơn nào trùng mã, không đơn nào mất dòng hàng', async () => {
    const created = await Promise.all(
      Array.from({ length: 20 }, () => createOrder(draft({ payment: { amount: 110_000, method: 'cash', note: '' } }))),
    )

    const codes = created.map((order) => order.code)
    expect(new Set(codes).size).toBe(20)
    expect(await db.orders.count()).toBe(20)
    for (const { id } of created) expect(await getOrderLines(id)).toHaveLength(1)
  }, 30_000)

  it('lịch sử đơn của khách xếp mới nhất lên đầu', async () => {
    const older = await createOrder(draft({ soldAt: soldAt - 86_400_000 }))
    const newer = await createOrder(draft({ soldAt }))

    const history = await listOrdersByCustomer(1)
    expect(history.map((order) => order.id)).toEqual([newer.id, older.id])
  })

  it('300 đơn trong cùng một ngày: mã không trùng, đánh số 001..300', async () => {
    for (let i = 0; i < 300; i += 1) {
      await createOrder(draft({ soldAt: soldAt + i * 1_000 }))
    }

    const codes = (await db.orders.toArray()).map((order) => order.code).sort()
    expect(codes).toHaveLength(300)
    expect(new Set(codes).size).toBe(300)
    expect(codes[0]).toBe('PBH-260807-A001')
    expect(codes.at(-1)).toBe('PBH-260807-A300')
  }, 60_000)

  it('sang ngày mới thì số phiếu quay về 001', async () => {
    await createOrder(draft())
    const next = await createOrder(draft({ soldAt: new Date(2026, 7, 8, 9, 0).getTime() }))
    expect((await db.orders.get(next.id))?.code).toBe('PBH-260808-A001')
  })
})

/**
 * Hàm này đổi thuật toán ở ngưỡng `WIDE_QUERY` (1.500 đơn). Hai nhánh phải cho **cùng một kết quả**,
 * nếu không thì kỳ báo cáo rộng ra vừa đủ chạm ngưỡng là giá vốn với lợi nhuận nhảy số mà không ai
 * biết vì sao.
 *
 * Ghi thẳng vào bảng chứ không qua `createOrder`: chỗ cần thử là đường đọc, mà dựng 1.600 đơn thật
 * thì mất cả phút.
 */
describe('listOrderLinesOfOrders', () => {
  const seedLines = (count: number) =>
    db.orderLines.bulkAdd(
      Array.from({ length: count }, (_, index) => ({
        gid: testGid(index + 1),
        orderId: index + 1,
        itemId: null,
        name: `Món ${index + 1}`,
        unit: '',
        unitPrice: 1_000,
        costPrice: null,
        qty: 1,
        amount: 1_000,
        note: '',
      })),
    )

  // Mỗi ca thừa ra 50 đơn không được hỏi tới: trả cả bảng về cũng phải bị bắt.
  it.each([
    ['dưới ngưỡng — đi bằng anyOf', 5],
    ['từ ngưỡng trở lên — đọc cả bảng rồi lọc', 1_600],
  ])('%s: chỉ trả dòng của đúng những đơn được hỏi', async (_label, asked) => {
    await seedLines(asked + 50)
    const wanted = Array.from({ length: asked }, (_, index) => index + 1)

    const lines = await listOrderLinesOfOrders(wanted)

    expect(lines).toHaveLength(asked)
    expect([...new Set(lines.map((line) => line.orderId))].sort((a, b) => a - b)).toEqual(wanted)
  })
})

describe('ghi chú từng món', () => {
  it('chốt đơn có ghi chú dòng thì sổ giữ lại ghi chú đó', async () => {
    // Chốt chặn của phase này PHẢI là ca hành vi, không phải kiểu: `note` để optional trong
    // `OrderLineDraft` (tránh sửa ~25 file test), nên TypeScript KHÔNG ép call site nhớ truyền nó.
    // Quên một dòng map ở sales-page là ghi chú lại biến mất im lặng như trước.
    const { id } = await createOrder(
      draft({
        lines: [
          { itemId: null, name: 'Cà phê sữa', unit: 'ly', unitPrice: 20_000, costPrice: 8_000, qty: 1, note: 'ít đường' },
          { itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: 500, qty: 2 },
        ],
      }),
    )

    const lines = await getOrderLines(id)
    expect(lines.map((line) => line.note)).toEqual(['ít đường', ''])
  })

  it('dòng ghi trước khi có trường này đọc ra chuỗi rỗng, không phải undefined', async () => {
    // `getOrderLines` trả thẳng row Dexie, không qua zod. Đơn cũ không mang `note` nên kiểu sẽ nói
    // dối là `string`. Phase 4 (tem) chỉ cần đọc một lần qua đó là in chữ "undefined" lên tem khách.
    await db.orderLines.add({
      gid: testGid(901),
      orderId: 4242,
      itemId: null,
      name: 'Phở bò',
      unit: 'tô',
      unitPrice: 55_000,
      costPrice: null,
      qty: 1,
      amount: 55_000,
    } as never)

    const [line] = await getOrderLines(4242)
    expect(line?.note).toBe('')
  })

  it('listOrderLinesOfOrders vá cùng một cửa đọc, không để lời nói dối ở hàm kia', async () => {
    await db.orderLines.add({
      gid: testGid(902),
      orderId: 4243,
      itemId: null,
      name: 'Trà đá',
      unit: 'ly',
      unitPrice: 3_000,
      costPrice: null,
      qty: 1,
      amount: 3_000,
    } as never)

    const [line] = await listOrderLinesOfOrders([4243])
    expect(line?.note).toBe('')
  })
})

