// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DebtListPage } from '../debt-list-page'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createOrder } from '@/db/repositories/orders'
import { CustomerDetailPage } from '@/features/customers/customer-detail-page'
import { ReportPage } from '@/features/reports/report-page'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const box = (label: string) => screen.getByText(label).parentElement as HTMLElement

// Trang khách hàng có cả ô tổng "Còn nợ" lẫn chip "Còn nợ" trên từng đơn — nhãn ô là thẻ <p>.
const debtBox = () => screen.getByText('Còn nợ', { selector: 'p' }).parentElement as HTMLElement

async function seed() {
  const hoa = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
  const sell = (customerId: number, name: string, amount: number, day: number, paid: number) =>
    createOrder({
      customerId,
      customerName: name,
      lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: amount, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: new Date(2026, 7, day, 10).getTime(),
      note: '',
      payment: paid > 0 ? { amount: paid, method: 'cash', note: '' } : null,
    })

  await sell(hoa, 'Chị Hoa', 200_000, 1, 50_000) // còn 150.000
  await sell(hoa, 'Chị Hoa', 100_000, 3, 0) //      còn 100.000
  const voided = await sell(hoa, 'Chị Hoa', 900_000, 4, 0)
  await db.orders.update(voided.id, { status: 'void', paidAmount: 0 })

  return hoa
}

/** 250.000 phải xuất hiện y hệt ở cả ba màn — đây là tiêu chí "3 chỗ, 1 nguồn" của Phase 7. */
const OWED = '250.000'

describe('tổng nợ ở ba màn', () => {
  it('màn Công nợ', async () => {
    await seed()
    render(
      <MemoryRouter>
        <DebtListPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(within(box('TỔNG NỢ')).getByText(OWED)).toBeDefined())
  })

  it('card ở màn Báo cáo, bấm được sang màn Công nợ', async () => {
    await seed()
    render(
      <MemoryRouter initialEntries={['/bao-cao']}>
        <Routes>
          <Route path="/bao-cao" element={<ReportPage />} />
          <Route path="/cong-no" element={<DebtListPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(within(box('KHÁCH CÒN NỢ')).getByText(`${OWED} đ`)).toBeDefined())

    await userEvent.click(screen.getByRole('link', { name: /KHÁCH CÒN NỢ/ }))

    await waitFor(() => expect(within(box('TỔNG NỢ')).getByText(OWED)).toBeDefined())
  })

  it('trang khách hàng', async () => {
    const hoa = await seed()
    render(
      <MemoryRouter initialEntries={[`/them/khach-hang/${hoa}`]}>
        <Routes>
          <Route path="/them/khach-hang/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(within(debtBox()).getByText(`${OWED} đ`)).toBeDefined())
    // Đơn huỷ 900.000 không được cộng vào "Đã mua".
    expect(within(box('Đã mua')).getByText('300.000 đ')).toBeDefined()
  })

  it('thu nợ ở trang khách hàng ghi đủ lịch sử và trừ đúng đơn cũ nhất', async () => {
    const hoa = await seed()
    render(
      <MemoryRouter initialEntries={[`/them/khach-hang/${hoa}`]}>
        <Routes>
          <Route path="/them/khach-hang/:id" element={<CustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'THU NỢ' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^THU/ }))

    await waitFor(() => expect(within(debtBox()).getByText('0 đ')).toBeDefined())

    // 1 phiếu lúc bán + 2 phiếu vừa thu (một cho mỗi đơn còn nợ).
    expect(screen.getByText('Lịch sử thu tiền')).toBeDefined()
    expect(await db.payments.count()).toBe(3)
    expect(screen.queryByRole('button', { name: 'THU NỢ' })).toBeNull()
  })
})
