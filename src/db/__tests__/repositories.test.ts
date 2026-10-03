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
import {
  createGroup,
  createItem,
  deactivateItem,
  deleteGroup,
  getGroup,
  listActiveItems,
  updateGroup,
} from '../repositories/items'
import { createOrder, listRecentLineNotes } from '../repositories/orders'
import { getShop, saveShop } from '../repositories/settings'
import { installTestDevice, testGid } from '@/test-fixtures'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

describe('settings', () => {
  it('lần chạy đầu trả về mặc định thay vì undefined', async () => {
    expect(await getShop()).toEqual({
      name: '',
      phone: '',
      address: '',
      footerNote: 'Cảm ơn quý khách!',
      logo: null,
      labelWatermark: { enabled: false, position: 'center', strength: 'light' },
    })
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

describe('thực đơn tuỳ chọn và topping của nhóm món', () => {
  it('lưu và đọc lại nguyên vẹn; đổi tên nhóm không làm mất thực đơn', async () => {
    const id = await createGroup({ name: 'Đồ uống', sortOrder: 1 })
    expect((await getGroup(id))?.optionGroups).toEqual([])

    await updateGroup(id, {
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
      toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
    })
    await updateGroup(id, { name: 'Nước uống' })

    expect(await getGroup(id)).toMatchObject({
      name: 'Nước uống',
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
      toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
    })
  })

  it('từ chối nhóm tuỳ chọn không có lựa chọn và topping giá âm hay lẻ', async () => {
    const id = await createGroup({ name: 'Đồ uống', sortOrder: 1 })
    await expect(updateGroup(id, { optionGroups: [{ name: 'Đường', choices: [] }] })).rejects.toThrow()
    await expect(updateGroup(id, { toppingMenu: [{ name: 'Thạch', price: -1 }] })).rejects.toThrow()
    await expect(updateGroup(id, { toppingMenu: [{ name: 'Thạch', price: 1.5 }] })).rejects.toThrow()
  })

  it('đổi tên nhóm ghi từ trước khi có thực đơn KHÔNG thêm hai trường thực đơn vào hàng (để Worker giữ bản đã lưu)', async () => {
    const legacy = { gid: testGid(7), name: 'Đồ uống', sortOrder: 1, createdAt: 1, updatedAt: 1 }
    const id = await db.itemGroups.add(legacy as never)

    await updateGroup(id, { name: 'Nước uống' })

    const raw = await db.itemGroups.where(':id').equals(id).raw().first()
    expect(raw).toMatchObject({ name: 'Nước uống' })
    expect(raw).not.toHaveProperty('optionGroups')
    expect(raw).not.toHaveProperty('toppingMenu')
    expect(await getGroup(id)).toMatchObject({ optionGroups: [], toppingMenu: [] })
  })

  it('chỉ trường người dùng đang sửa được ghi; xoá chủ ý ([]) cũng được ghi', async () => {
    const legacy = { gid: testGid(8), name: 'Đồ uống', sortOrder: 1, createdAt: 1, updatedAt: 1 }
    const id = await db.itemGroups.add(legacy as never)

    await updateGroup(id, { toppingMenu: [{ name: 'Thạch', price: 3_000 }] })
    const set = await db.itemGroups.where(':id').equals(id).raw().first()
    expect(set).toMatchObject({ toppingMenu: [{ name: 'Thạch', price: 3_000 }] })
    expect(set).not.toHaveProperty('optionGroups')

    await updateGroup(id, { toppingMenu: [], optionGroups: [] })
    expect(await db.itemGroups.where(':id').equals(id).raw().first()).toMatchObject({ toppingMenu: [], optionGroups: [] })
  })

  it('nhóm tạo bằng bản này đã có hai trường nên đổi tên giữ nguyên chúng', async () => {
    const id = await createGroup({ name: 'Đồ uống', sortOrder: 1, toppingMenu: [{ name: 'Thạch', price: 3_000 }] })
    await updateGroup(id, { name: 'Nước uống' })

    expect(await db.itemGroups.where(':id').equals(id).raw().first()).toMatchObject({
      name: 'Nước uống',
      toppingMenu: [{ name: 'Thạch', price: 3_000 }],
      optionGroups: [],
    })
  })
})

describe('ghi chú gần đây', () => {
  // Đơn chưa thu phải có chủ nợ; ca này chỉ đọc ghi chú nên ghi nợ cho một khách là đủ.
  const sell = async (notes: string[]) =>
    createOrder({
      customerId: await createCustomer({ name: 'Anh Hùng', phone: '', address: '', note: '' }),
      customerName: 'Anh Hùng',
      lines: notes.map((note) => ({ itemId: null, name: 'Phở', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 1, note })),
      discount: 0,
      surcharge: 0,
      soldAt,
      note: '',
      payment: null,
    })

  it('trả ghi chú của các dòng bán gần nhất, mới nhất trước, bỏ dòng không ghi chú và dừng ở giới hạn', async () => {
    await sell(['ít hành', ''])
    await sell(['mang về'])
    await sell(['cay'])

    expect(await listRecentLineNotes(10)).toEqual(['cay', 'mang về', 'ít hành'])
    expect(await listRecentLineNotes(2)).toEqual(['cay', 'mang về'])
  })
})
