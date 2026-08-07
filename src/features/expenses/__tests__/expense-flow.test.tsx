// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExpenseListPage } from '../expense-list-page'
import { db } from '@/db/db'
import { createExpense, createExpenseCategory } from '@/db/repositories/expenses'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <ExpenseListPage />
    </MemoryRouter>,
  )

/** Ô tổng gồm nhãn và số nằm cạnh nhau — lấy theo nhãn để không đụng số trùng ở danh sách dưới. */
const box = (label: string) => screen.getByText(label).parentElement as HTMLElement

const spend = (amount: number, spentAt: number, note = '', categoryId: number | null = null) =>
  createExpense({ categoryId, amount, note, spentAt })

describe('màn chi phí', () => {
  it('khoản lúc 23:50 và 00:10 rơi đúng tháng, đúng ngày theo giờ địa phương', async () => {
    // Cả bài test này chỉ có nghĩa khi chạy ở giờ Việt Nam — vite.config.ts ghim TZ, đây là chốt chặn.
    expect(new Date(NOW).getTimezoneOffset()).toBe(-420)

    await spend(100_000, at(2026, 7, 31, 23, 50), 'Cuối tháng 7')
    await spend(200_000, at(2026, 8, 1, 0, 10), 'Đầu tháng 8')
    await spend(50_000, at(2026, 8, 7, 0, 10), 'Sáng sớm nay')
    await spend(70_000, at(2026, 8, 6, 23, 50), 'Khuya hôm qua')

    renderPage()

    // Tháng 8 = 200 + 50 + 70. Khoản 23:50 ngày 31/7 phải nằm ngoài; tính theo UTC thì khoản 00:10
    // ngày 1/8 sẽ tụt về tháng 7 và con số này hụt 200.000.
    expect(await screen.findByText('−320.000')).toBeDefined()
    expect(within(box('CHI THÁNG 8')).getByText('−320.000')).toBeDefined()
    // Hôm nay chỉ có khoản 00:10 — theo UTC thì nó thuộc hôm qua và ô này về 0.
    expect(within(box('CHI HÔM NAY')).getByText('−50.000')).toBeDefined()
  })

  it('lùi tháng thì tổng đổi theo, còn "hôm nay" vẫn là hôm nay', async () => {
    await spend(100_000, at(2026, 7, 31, 23, 50), 'Cuối tháng 7')
    await spend(50_000, at(2026, 8, 7, 0, 10), 'Sáng sớm nay')

    renderPage()
    await screen.findByText('Tháng 8/2026')

    await userEvent.click(screen.getByRole('button', { name: 'Tháng trước' }))

    expect(await screen.findByText('Tháng 7/2026')).toBeDefined()
    expect(within(box('CHI THÁNG 7')).getByText('−100.000')).toBeDefined()
    expect(within(box('CHI HÔM NAY')).getByText('−50.000')).toBeDefined()
  })

  it('không cho xem tháng chưa tới', async () => {
    renderPage()
    await screen.findByText('Tháng 8/2026')

    const next = screen.getByRole('button', { name: 'Tháng sau' })
    expect((next as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Tháng trước' }))
    await screen.findByText('Tháng 7/2026')
    expect((screen.getByRole('button', { name: 'Tháng sau' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('lần đầu mở màn đã có sẵn loại để chọn, không bắt tự nghĩ ra', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: 'Nguyên liệu' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Thuê' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Khác' })).toBeDefined()
  })

  it('ghi một khoản chi: tiền, loại, ghi chú rồi lưu', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Nguyên liệu' })

    await userEvent.click(screen.getByRole('button', { name: /Ghi chi phí/ }))
    const sheet = screen.getByRole('dialog')

    await userEvent.type(within(sheet).getByLabelText('Số tiền'), '250000')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Nguyên liệu' }))
    await userEvent.type(within(sheet).getByLabelText('Ghi chú'), 'Chợ đầu mối')
    await userEvent.click(within(sheet).getByRole('button', { name: 'LƯU' }))

    expect(await screen.findByText('Chợ đầu mối')).toBeDefined()
    expect(within(box('CHI THÁNG 8')).getByText('−250.000')).toBeDefined()
    expect(await db.expenses.count()).toBe(1)
  })

  it('bỏ trống ghi chú thì tên loại lên làm tiêu đề, không lặp lại ở dòng dưới', async () => {
    const categoryId = await createExpenseCategory({ name: 'Thuê' })
    await spend(2_000_000, at(2026, 8, 7, 9, 0), '', categoryId)

    renderPage()

    const row = (await screen.findByText('Thuê', { selector: 'span.font-semibold' })).closest(
      'button',
    ) as HTMLElement
    expect(within(row).getByText('09:00')).toBeDefined()
    expect(within(row).getAllByText(/Thuê/)).toHaveLength(1)
  })

  it('số chi hiện dấu trừ và màu đỏ, không nhầm với doanh thu', async () => {
    await spend(120_000, at(2026, 8, 7, 9, 0), 'Gas')

    renderPage()

    const row = (await screen.findByText('Gas')).closest('button') as HTMLElement
    expect(within(row).getByText('−120.000').className).toContain('text-danger')
    expect(within(box('CHI THÁNG 8')).getByText('−120.000').className).toContain('text-danger')
  })

  it('lọc theo loại: danh sách và cả hai ô tổng đều theo loại đang chọn', async () => {
    const nguyenLieu = await createExpenseCategory({ name: 'Nguyên liệu' })
    const thue = await createExpenseCategory({ name: 'Thuê' })
    await spend(300_000, at(2026, 8, 7, 8, 0), 'Rau củ', nguyenLieu)
    await spend(2_000_000, at(2026, 8, 3, 8, 0), 'Tiền nhà', thue)

    renderPage()
    await screen.findByText('Rau củ')

    await userEvent.click(await screen.findByRole('button', { name: 'Thuê' }))

    await waitFor(() => expect(screen.queryByText('Rau củ')).toBeNull())
    expect(screen.getByText('Tiền nhà')).toBeDefined()
    expect(within(box('CHI THÁNG 8')).getByText('−2.000.000')).toBeDefined()
    // Khoản của loại khác không được lọt vào ô "hôm nay" khi đang lọc.
    expect(within(box('CHI HÔM NAY')).getByText('0')).toBeDefined()
    expect(screen.getByText(/Hai ô trên chỉ tính loại “Thuê”/)).toBeDefined()
  })

  it('chạm vào dòng để sửa số tiền', async () => {
    await spend(120_000, at(2026, 8, 7, 9, 0), 'Gas')

    renderPage()
    await userEvent.click(await screen.findByText('Gas'))

    const sheet = screen.getByRole('dialog')
    const amount = within(sheet).getByLabelText('Số tiền')
    expect((amount as HTMLInputElement).value).toBe('120.000')

    await userEvent.clear(amount)
    await userEvent.type(amount, '150000')
    await userEvent.click(within(sheet).getByRole('button', { name: 'LƯU' }))

    await waitFor(async () => expect((await db.expenses.toArray())[0]?.amount).toBe(150_000))
  })

  it('xoá khoản chi phải hỏi lại trước', async () => {
    await spend(120_000, at(2026, 8, 7, 9, 0), 'Gas')

    renderPage()
    await userEvent.click(await screen.findByText('Gas'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá khoản chi' }))

    const confirm = screen.getByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Xoá' }))

    await waitFor(async () => expect(await db.expenses.count()).toBe(0))
  })

  it('không ghi được khoản chi cho ngày chưa tới', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Nguyên liệu' })
    await userEvent.click(screen.getByRole('button', { name: /Ghi chi phí/ }))

    const sheet = screen.getByRole('dialog')
    await userEvent.type(within(sheet).getByLabelText('Số tiền'), '50000')

    const date = within(sheet).getByLabelText('Ngày chi') as HTMLInputElement
    expect(date.value).toBe('2026-08-07')
    expect(date.max).toBe('2026-08-07')

    fireEvent.change(date, { target: { value: '2026-08-09' } })

    expect(within(sheet).getByText(/Chưa tới ngày đó/)).toBeDefined()
    expect((within(sheet).getByRole('button', { name: 'LƯU' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('đổi ngày nhưng giữ nguyên giờ, để khoản 23:50 không nhảy sang ngày khác', async () => {
    await spend(120_000, at(2026, 8, 7, 23, 50), 'Gas')

    renderPage()
    await userEvent.click(await screen.findByText('Gas'))

    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Ngày chi'), { target: { value: '2026-08-05' } })
    await userEvent.click(within(sheet).getByRole('button', { name: 'LƯU' }))

    await waitFor(async () => {
      const spentAt = new Date((await db.expenses.toArray())[0]?.spentAt ?? 0)
      expect([spentAt.getDate(), spentAt.getHours(), spentAt.getMinutes()]).toEqual([5, 23, 50])
    })
  })

  it('tháng chưa có khoản nào thì nhắc luôn cái bẫy tính hai lần với giá nhập', async () => {
    renderPage()

    expect(await screen.findByText(/Chưa ghi khoản chi nào tháng này/)).toBeDefined()
    expect(screen.getByText(/tính hai lần/)).toBeDefined()
  })
})
