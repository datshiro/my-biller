import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectBackup, countAllRecords, replaceAllData, wipeAllData } from '../backup'
import { db } from '../db'
import { recalcAll } from '../recalc'
import { createExpense, createExpenseCategory } from '../repositories/expenses'
import { createGroup, createItem } from '../repositories/items'
import { createCustomer } from '../repositories/customers'
import { savePriceBook } from '../repositories/customer-prices'
import { createOrder } from '../repositories/orders'
import { addOrderPayment } from '../repositories/payments'
import { saveShop } from '../repositories/settings'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()
const exportedAt = new Date(2026, 7, 7, 14, 0).getTime()

/**
 * Một cửa hàng thu nhỏ nhưng đủ mọi bảng — sao lưu mà rơi một bảng là mất tiền thật.
 *
 * Mọi trường tuỳ chọn đều được điền **khác giá trị mặc định** (ghi chú, địa chỉ, nhóm, giá nhập,
 * giảm giá, phụ thu): để trống thì một bản sao lưu đánh rơi hẳn trường đó vẫn khớp lại y hệt và
 * không test nào kêu.
 */
async function seedShop() {
  await saveShop({
    name: 'Tạp hoá Cô Ba',
    phone: '0900000000',
    address: '12 Lê Lợi, P.3',
    footerNote: 'Hẹn gặp lại!',
  })
  const groupId = await createGroup({ name: 'Món nước', sortOrder: 10 })
  const customerId = await createCustomer({
    name: 'Chị Hoa',
    phone: '0911',
    address: 'Cuối hẻm 5',
    note: 'Trả cuối tháng',
  })
  const itemId = await createItem({
    name: 'Phở',
    groupId,
    unit: 'tô',
    unitPrice: 50_000,
    costPrice: 20_000,
    isActive: 1,
    note: 'Không hành',
  })
  await savePriceBook(customerId, [{ itemId, unitPrice: 45_000 }])
  const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
  await createExpense({ categoryId, amount: 300_000, note: 'Chợ', spentAt: soldAt })

  const { id } = await createOrder({
    customerId,
    customerName: 'Chị Hoa',
    lines: [{ itemId, name: 'Phở', unit: 'tô', unitPrice: 50_000, costPrice: 20_000, qty: 2 }],
    discount: 5_000,
    surcharge: 5_000,
    soldAt,
    note: 'Giao trước 11h',
    payment: null,
  })
  await addOrderPayment({ orderId: id, amount: 40_000, method: 'cash', paidAt: soldAt, note: 'Trả trước' })
  return id
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('collectBackup', () => {
  it('gom đủ mọi bảng và đóng dấu app/version để nhận ra file lạ', async () => {
    await seedShop()

    const file = await collectBackup(exportedAt)

    expect(file.app).toBe('my-biller')
    expect(file.version).toBe(2)
    expect(file.exportedAt).toBe(new Date(exportedAt).toISOString())
    expect(Object.entries(file.data).filter(([, rows]) => rows.length === 0)).toEqual([])
  })

  it('một bản ghi lạ không làm chết cả lần sao lưu', async () => {
    await seedShop()
    // Ghi thẳng vào bảng, không qua schema: giả cảnh bản build cũ hoặc người dùng sửa tay qua DevTools.
    // Sao lưu chết ở đây là khoá luôn đường nhập file, vì nhập file có xuất bản an toàn trước.
    await db.items.add({
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: soldAt,
      updatedAt: soldAt,
    })

    expect((await collectBackup(exportedAt)).data.items).toHaveLength(2)
  })
})

describe('xuất → xoá → nhập', () => {
  it('mọi số khớp lại 100%, id giữ nguyên nên dòng đơn vẫn dính đúng đơn', async () => {
    const orderId = await seedShop()
    const file = await collectBackup(exportedAt)
    const before = await countAllRecords()

    await wipeAllData()
    expect(await countAllRecords()).toBe(0)

    await replaceAllData(file.data)

    expect(await countAllRecords()).toBe(before)
    expect(await db.orders.get(orderId)).toMatchObject({ total: 100_000, paidAmount: 40_000, status: 'partial' })
    expect(await db.orderLines.where('orderId').equals(orderId).count()).toBe(1)
    expect(await db.payments.where('orderId').equals(orderId).count()).toBe(1)
    expect((await collectBackup(exportedAt)).data).toEqual(file.data)
  })

  it('file có paidAmount sai thì recalcAll dựng lại theo payments, không tin con số trong file', async () => {
    const orderId = await seedShop()
    const file = await collectBackup(exportedAt)

    // Giả cảnh file bị sửa tay hoặc đến từ bản cũ có bug: đơn ghi đã trả đủ mà chỉ có 1 phiếu thu 40k.
    const broken = {
      ...file.data,
      orders: file.data.orders.map((order) => ({ ...order, paidAmount: order.total, status: 'paid' as const })),
    }

    await replaceAllData(broken)
    expect(await recalcAll()).toBe(1)
    expect(await db.orders.get(orderId)).toMatchObject({ paidAmount: 40_000, status: 'partial' })
  })

  it('đơn huỷ vẫn là huỷ sau khi nhập, và không còn treo đồng nào đã thu', async () => {
    const orderId = await seedShop()
    // Đặt thẳng `status` chứ không gọi `voidOrder`: giả đúng cảnh file sao lưu có đơn huỷ mà phiếu
    // thu vẫn còn — `recalcAll` không được để đơn "Đã huỷ" hiện "Đã thu 40.000 đ".
    await db.orders.update(orderId, { status: 'void' })
    const file = await collectBackup(exportedAt)

    await wipeAllData()
    await replaceAllData(file.data)
    await recalcAll()

    expect(await db.orders.get(orderId)).toMatchObject({ status: 'void', paidAmount: 0 })
    // Phiếu thu phải đi theo đơn: lịch sử thu tiền của khách và tổng "Đã thu" của kỳ đọc thẳng bảng
    // `payments`, không đọc `paidAmount`.
    expect(await db.payments.where('orderId').equals(orderId).count()).toBe(0)
  })

  it('recalcAll không đóng dấu ngày nhập lên đơn cũ', async () => {
    const orderId = await seedShop()
    await db.orders.update(orderId, { paidAmount: 999, updatedAt: soldAt })

    expect(await recalcAll()).toBe(1)
    expect((await db.orders.get(orderId))?.updatedAt).toBe(soldAt)
  })
})

describe('replaceAllData', () => {
  it('nạp file rỗng thì sạch bảng, không trộn với dữ liệu cũ', async () => {
    await seedShop()
    const empty = (await collectBackup(exportedAt)).data
    for (const key of Object.keys(empty) as (keyof typeof empty)[]) {
      Object.assign(empty, { [key]: [] })
    }

    await replaceAllData(empty)

    expect(await countAllRecords()).toBe(0)
  })

  /**
   * Rác trong bảng giá **không** chặn cả file: dòng mồ côi không bao giờ được đọc nên không đụng tới
   * đồng nào, mà chặn thì đường ra duy nhất là sửa tay JSON. Bỏ dòng, và số dòng bỏ đã được nói ra ở
   * cửa xác nhận trước đó.
   */
  it('dòng giá mồ côi trong file bị bỏ, phần còn lại vẫn nhập bình thường', async () => {
    await seedShop()
    const data = (await collectBackup(exportedAt)).data
    const mồCôi = { id: 99, customerId: 404, itemId: 404, unitPrice: 1_000, createdAt: soldAt, updatedAt: soldAt }

    await replaceAllData({ ...data, customerPrices: [...data.customerPrices, mồCôi] })

    expect(await db.customerPrices.count()).toBe(1)
    expect(await db.customerPrices.get(99)).toBeUndefined()
  })
})
