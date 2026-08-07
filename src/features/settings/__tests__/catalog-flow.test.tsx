// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpenseCategoryPage } from '../expense-category-page'
import { ItemGroupPage } from '../item-group-page'
import { db } from '@/db/db'
import { createExpense, createExpenseCategory } from '@/db/repositories/expenses'
import { appendGroup, createItem } from '@/db/repositories/items'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterEach(cleanup)

const renderPage = (page: React.ReactElement) => render(<MemoryRouter>{page}</MemoryRouter>)

const openRow = async (name: string) => userEvent.click(await screen.findByText(name))

/** Nút "Xoá" trong hộp xác nhận — trong sheet cũng có một nút cùng tên. */
const confirmButton = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xoá' })

describe('loại chi phí', () => {
  it('thêm loại mới', async () => {
    renderPage(<ExpenseCategoryPage />)

    await userEvent.click(await screen.findByRole('button', { name: '＋ Thêm loại' }))
    await userEvent.type(screen.getByLabelText('Tên'), 'Điện nước')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(async () => expect(await db.expenseCategories.count()).toBe(1))
  })

  it('trùng tên thì chặn ngay, không tạo hai loại giống nhau', async () => {
    await createExpenseCategory({ name: 'Nguyên liệu' })
    renderPage(<ExpenseCategoryPage />)

    await userEvent.click(await screen.findByRole('button', { name: '＋ Thêm loại' }))
    await userEvent.type(screen.getByLabelText('Tên'), 'nguyên liệu')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    expect(screen.getByText('Tên này đã có rồi.')).toBeDefined()
    expect(await db.expenseCategories.count()).toBe(1)
  })

  it('đổi tên loại: khoản chi cũ vẫn thuộc loại đó, chỉ đổi nhãn', async () => {
    const categoryId = await createExpenseCategory({ name: 'Thuê' })
    await createExpense({ categoryId, amount: 2_000_000, note: '', spentAt: Date.now() })

    renderPage(<ExpenseCategoryPage />)
    await openRow('Thuê')

    const input = screen.getByLabelText('Tên')
    await userEvent.clear(input)
    await userEvent.type(input, 'Thuê mặt bằng')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU' }))

    await waitFor(async () => expect((await db.expenseCategories.get(categoryId))?.name).toBe('Thuê mặt bằng'))
    expect(await db.expenses.where('categoryId').equals(categoryId).count()).toBe(1)
  })

  it('đang có khoản chi thì nút Xoá tắt và nói rõ phải làm gì trước', async () => {
    const categoryId = await createExpenseCategory({ name: 'Thuê' })
    await createExpense({ categoryId, amount: 2_000_000, note: '', spentAt: Date.now() })

    renderPage(<ExpenseCategoryPage />)
    expect(await screen.findByText('1 khoản chi')).toBeDefined()

    await openRow('Thuê')
    expect(screen.getByRole('button', { name: 'Xoá' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(/Đổi loại cho chúng trước/)).toBeDefined()
  })

  it('loại chưa dùng thì xoá được', async () => {
    await createExpenseCategory({ name: 'Khác' })

    renderPage(<ExpenseCategoryPage />)
    await openRow('Khác')
    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    await userEvent.click(confirmButton())

    await waitFor(async () => expect(await db.expenseCategories.count()).toBe(0))
  })
})

describe('nhóm mặt hàng', () => {
  it('xoá nhóm thì mặt hàng về "chưa phân nhóm", không mất hàng', async () => {
    const groupId = await appendGroup('Đồ uống')
    const itemId = await createItem({
      name: 'Cà phê',
      groupId,
      unit: 'ly',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
    })

    renderPage(<ItemGroupPage />)
    expect(await screen.findByText('1 mặt hàng')).toBeDefined()

    await openRow('Đồ uống')
    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    expect(screen.getByText(/1 mặt hàng trong nhóm sẽ về/)).toBeDefined()
    await userEvent.click(confirmButton())

    await waitFor(async () => expect(await db.itemGroups.count()).toBe(0))
    expect((await db.items.get(itemId))?.groupId).toBeNull()
  })
})
