// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DebtListPage } from '../debt-list-page'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createOrder } from '@/db/repositories/orders'
import { installTestDevice } from '@/test-fixtures'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()
const at = (day: number, month = 7) => new Date(2026, month, day, 10).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <DebtListPage />
    </MemoryRouter>,
  )

const box = (label: string) => screen.getByText(label).parentElement as HTMLElement

async function sellOnCredit(customerId: number, name: string, amount: number, soldAt: number) {
  return createOrder({
    customerId,
    customerName: name,
    lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: amount, costPrice: null, qty: 1 }],
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: null,
  })
}

async function seedCustomer(name: string, amounts: [number, number][]) {
  const customerId = await createCustomer({ name, phone: '', address: '', note: '' })
  for (const [amount, day] of amounts) await sellOnCredit(customerId, name, amount, at(day))
  return customerId
}

describe('màn công nợ', () => {
  it('gộp nợ theo khách, nợ lâu nhất lên đầu', async () => {
    await seedCustomer('Chị Hoa', [[100_000, 1], [200_000, 3]])
    await seedCustomer('Anh Ba', [[50_000, 5]])

    renderPage()

    expect(await screen.findByText('Chị Hoa')).toBeDefined()
    const rows = screen.getAllByRole('button').filter((node) => /Chị Hoa|Anh Ba/.test(node.textContent ?? ''))
    expect(rows.map((row) => row.textContent?.includes('Chị Hoa'))).toEqual([true, false])

    expect(within(rows[0] as HTMLElement).getByText('300.000 đ')).toBeDefined()
    expect(within(rows[0] as HTMLElement).getByText('2 đơn · 6 ngày')).toBeDefined()
    expect(within(box('TỔNG NỢ')).getByText('350.000')).toBeDefined()
    expect(within(box('SỐ KHÁCH')).getByText('2')).toBeDefined()
  })

  it('chỉ nợ quá 30 ngày mới bị gắn nhãn', async () => {
    const cu = await createCustomer({ name: 'Anh Ba', phone: '', address: '', note: '' })
    await sellOnCredit(cu, 'Anh Ba', 50_000, at(25, 5)) // 25/6 → 43 ngày
    await seedCustomer('Chị Hoa', [[100_000, 1]]) // 01/8 → 6 ngày

    renderPage()

    await screen.findByText('Anh Ba')
    const old = screen.getByText('Anh Ba').closest('button') as HTMLElement
    expect(within(old).getByText('Quá 30 ngày')).toBeDefined()
    expect(within(old).getByText('1 đơn · 43 ngày')).toBeDefined()

    const recent = screen.getByText('Chị Hoa').closest('button') as HTMLElement
    expect(within(recent).queryByText('Quá 30 ngày')).toBeNull()
  })

  it('thu một phần: trừ đơn cũ trước, danh sách tự trừ số còn lại', async () => {
    await seedCustomer('Chị Hoa', [[100_000, 1], [200_000, 3]])

    renderPage()
    await userEvent.click(await screen.findByText('Chị Hoa'))

    const sheet = screen.getByRole('dialog')
    expect((within(sheet).getByLabelText('Thu bao nhiêu') as HTMLInputElement).value).toBe('300.000')

    await userEvent.clear(within(sheet).getByLabelText('Thu bao nhiêu'))
    await userEvent.type(within(sheet).getByLabelText('Thu bao nhiêu'), '250000')

    expect(within(sheet).getByText('Còn nợ sau khi thu')).toBeDefined()
    expect(within(sheet).getByText('50.000 đ')).toBeDefined()

    await userEvent.click(within(sheet).getByRole('button', { name: 'THU 250.000 đ' }))

    await waitFor(() => expect(within(box('TỔNG NỢ')).getByText('50.000')).toBeDefined())
    const orders = await db.orders.orderBy('soldAt').toArray()
    expect(orders.map((order) => order.status)).toEqual(['paid', 'partial'])
  })

  it('nút "Trả hết" điền đúng tổng nợ và thu xong thì khách rời danh sách', async () => {
    await seedCustomer('Chị Hoa', [[100_000, 1], [200_000, 3]])

    renderPage()
    await userEvent.click(await screen.findByText('Chị Hoa'))

    const sheet = screen.getByRole('dialog')
    await userEvent.clear(within(sheet).getByLabelText('Thu bao nhiêu'))
    await userEvent.type(within(sheet).getByLabelText('Thu bao nhiêu'), '1000')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Trả hết' }))

    expect((within(sheet).getByLabelText('Thu bao nhiêu') as HTMLInputElement).value).toBe('300.000')
    expect(within(sheet).getByText('Hết nợ')).toBeDefined()

    await userEvent.click(within(sheet).getByRole('button', { name: 'THU 300.000 đ' }))

    expect(await screen.findByText(/Chưa ai nợ tiền/)).toBeDefined()
  })

  it('thu quá số nợ bị chặn ngay ở nút, không đợi tới lúc lưu', async () => {
    await seedCustomer('Chị Hoa', [[100_000, 1]])

    renderPage()
    await userEvent.click(await screen.findByText('Chị Hoa'))

    const sheet = screen.getByRole('dialog')
    await userEvent.clear(within(sheet).getByLabelText('Thu bao nhiêu'))
    await userEvent.type(within(sheet).getByLabelText('Thu bao nhiêu'), '150000')

    expect(within(sheet).getByText('Khách chỉ còn nợ 100.000 đ.')).toBeDefined()
    expect((within(sheet).getByRole('button', { name: /^THU/ }) as HTMLButtonElement).disabled).toBe(true)
    // Chặn ở UI không được làm mất luôn dòng "còn nợ sau khi thu" thành số âm.
    expect(within(sheet).queryByText('Còn nợ sau khi thu')).toBeNull()
  })

  it('chưa ai nợ thì nói việc cần làm, không chỉ báo trống', async () => {
    renderPage()
    expect(await screen.findByText(/Bán nợ cho khách quen thì khoản đó hiện ở đây/)).toBeDefined()
  })

  it('đơn đã huỷ rời khỏi công nợ', async () => {
    const customerId = await seedCustomer('Chị Hoa', [[100_000, 1]])
    const { id } = await sellOnCredit(customerId, 'Chị Hoa', 500_000, at(2))

    renderPage()
    await waitFor(() => expect(within(box('TỔNG NỢ')).getByText('600.000')).toBeDefined())

    await db.orders.update(id, { status: 'void', paidAmount: 0 })

    await waitFor(() => expect(within(box('TỔNG NỢ')).getByText('100.000')).toBeDefined())
  })
})
