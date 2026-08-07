import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectBackup, countAllRecords, replaceAllData, wipeAllData } from '../backup'
import { db } from '../db'
import { recalcAll } from '../recalc'
import { createExpense, createExpenseCategory } from '../repositories/expenses'
import { createItem } from '../repositories/items'
import { createCustomer } from '../repositories/customers'
import { createOrder } from '../repositories/orders'
import { addOrderPayment } from '../repositories/payments'
import { saveShop } from '../repositories/settings'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()
const exportedAt = new Date(2026, 7, 7, 14, 0).getTime()

/** Một cửa hàng thu nhỏ nhưng đủ mọi bảng — sao lưu mà rơi một bảng là mất tiền thật. */
async function seedShop() {
  await saveShop({ name: 'Tạp hoá Cô Ba', phone: '0900000000' })
  const customerId = await createCustomer({ name: 'Chị Hoa', phone: '0911', address: '', note: '' })
  const itemId = await createItem({
    name: 'Phở',
    groupId: null,
    unit: 'tô',
    unitPrice: 50_000,
    costPrice: 20_000,
    isActive: 1,
  })
  const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
  await createExpense({ categoryId, amount: 300_000, note: 'Chợ', spentAt: soldAt })

  const { id } = await createOrder({
    customerId,
    customerName: 'Chị Hoa',
    lines: [{ itemId, name: 'Phở', unit: 'tô', unitPrice: 50_000, costPrice: 20_000, qty: 2 }],
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: null,
  })
  await addOrderPayment({ orderId: id, amount: 40_000, method: 'cash', paidAt: soldAt, note: '' })
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
    expect(file.version).toBe(1)
    expect(file.exportedAt).toBe(new Date(exportedAt).toISOString())
    expect(Object.entries(file.data).filter(([, rows]) => rows.length === 0)).toEqual([
      ['itemGroups', []],
    ])
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

  it('đơn huỷ vẫn là huỷ sau khi nhập, dù không có phiếu thu nào', async () => {
    const orderId = await seedShop()
    await db.orders.update(orderId, { status: 'void' })
    const file = await collectBackup(exportedAt)

    await wipeAllData()
    await replaceAllData(file.data)
    await recalcAll()

    expect((await db.orders.get(orderId))?.status).toBe('void')
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
})
