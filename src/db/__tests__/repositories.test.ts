import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createCustomer, deleteCustomer, searchCustomers } from '../repositories/customers'
import {
  createExpense,
  createExpenseCategory,
  deleteExpenseCategory,
  ensureDefaultExpenseCategories,
  listExpenseCategories,
  listExpensesBetween,
} from '../repositories/expenses'
import { createGroup, createItem, deactivateItem, deleteGroup, listActiveItems } from '../repositories/items'
import { createOrder } from '../repositories/orders'
import { getShop, saveShop } from '../repositories/settings'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('settings', () => {
  it('lần chạy đầu trả về mặc định thay vì undefined', async () => {
    expect(await getShop()).toEqual({ name: '', phone: '', address: '', footerNote: 'Cảm ơn quý khách!' })
  })

  it('lưu từng phần, không xoá trường chưa sửa', async () => {
    await saveShop({ name: 'Quán Bà Tư' })
    await saveShop({ phone: '0909' })
    expect(await getShop()).toMatchObject({ name: 'Quán Bà Tư', phone: '0909' })
  })
})

describe('items', () => {
  const item = { name: 'Phở bò', groupId: null, unit: 'tô', unitPrice: 55_000, costPrice: 30_000, isActive: 1 } as const

  it('chỉ liệt kê mặt hàng còn bán', async () => {
    const id = await createItem({ ...item })
    await createItem({ ...item, name: 'Bún bò' })
    await deactivateItem(id)

    expect((await listActiveItems()).map((row) => row.name)).toEqual(['Bún bò'])
  })

  it('xoá nhóm thì mặt hàng rơi về không nhóm, không bị xoá theo', async () => {
    const groupId = await createGroup({ name: 'Đồ ăn', sortOrder: 1 })
    await createItem({ ...item, groupId })

    await deleteGroup(groupId)

    const items = await db.items.toArray()
    expect(items).toHaveLength(1)
    expect(items[0]?.groupId).toBeNull()
  })
})

describe('customers', () => {
  it('tìm theo tên không dấu và theo số điện thoại', async () => {
    await createCustomer({ name: 'Anh Hùng', phone: '0912345678', address: '', note: '' })
    await createCustomer({ name: 'Chị Lan', phone: '0987654321', address: '', note: '' })

    expect((await searchCustomers('hung')).map((row) => row.name)).toEqual(['Anh Hùng'])
    expect((await searchCustomers('0987')).map((row) => row.name)).toEqual(['Chị Lan'])
    expect(await searchCustomers('')).toHaveLength(2)
  })

  it('số lưu có khoảng trắng vẫn tìm được khi gõ liền, và ngược lại', async () => {
    await createCustomer({ name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '' })

    expect((await searchCustomers('0912345')).map((row) => row.name)).toEqual(['Anh Hùng'])
    expect((await searchCustomers('345 678')).map((row) => row.name)).toEqual(['Anh Hùng'])
    expect(await searchCustomers('0999')).toEqual([])
  })

  it('từ chối xoá khách đã có đơn để không mất công nợ', async () => {
    const customerId = await createCustomer({ name: 'Anh Hùng', phone: '', address: '', note: '' })
    await createOrder({
      customerId,
      customerName: 'Anh Hùng',
      lines: [{ itemId: null, name: 'Phở', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt,
      note: '',
      payment: null,
    })

    await expect(deleteCustomer(customerId)).rejects.toThrow(/đã có 1 đơn/)
    expect(await db.customers.count()).toBe(1)
  })

  it('xoá được khách chưa phát sinh đơn', async () => {
    const customerId = await createCustomer({ name: 'Khách mới', phone: '', address: '', note: '' })
    await deleteCustomer(customerId)
    expect(await db.customers.count()).toBe(0)
  })
})

describe('expenses', () => {
  it('lọc theo khoảng thời gian', async () => {
    const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
    await createExpense({ categoryId, amount: 1_200_000, note: 'Chợ', spentAt: soldAt })
    await createExpense({ categoryId, amount: 300_000, note: 'Gas', spentAt: soldAt + 86_400_000 * 5 })

    const inRange = await listExpensesBetween(soldAt - 1, soldAt + 1)
    expect(inRange.map((row) => row.amount)).toEqual([1_200_000])
  })

  it('chặn xoá loại đang có khoản chi, và nói rõ đang vướng bao nhiêu khoản', async () => {
    const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
    await createExpense({ categoryId, amount: 500_000, note: '', spentAt: soldAt })

    await expect(deleteExpenseCategory(categoryId)).rejects.toThrow(/đang có 1 khoản chi/)

    expect(await db.expenseCategories.count()).toBe(1)
    expect((await db.expenses.toArray())[0]?.categoryId).toBe(categoryId)
  })

  it('loại chưa dùng thì xoá được bình thường', async () => {
    const categoryId = await createExpenseCategory({ name: 'Thuê' })

    await deleteExpenseCategory(categoryId)

    expect(await db.expenseCategories.count()).toBe(0)
  })

  it('tạo loại mặc định đúng một lần, gọi lại không nhân bản', async () => {
    await ensureDefaultExpenseCategories()
    await ensureDefaultExpenseCategories()

    const names = (await listExpenseCategories()).map((category) => category.name)
    expect(names).toEqual(['Khác', 'Nguyên liệu', 'Thuê'])
  })

  it('đã có loại sẵn thì không chèn thêm loại mặc định', async () => {
    await createExpenseCategory({ name: 'Xăng xe' })

    await ensureDefaultExpenseCategories()

    expect(await db.expenseCategories.count()).toBe(1)
  })
})
