// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportPage } from '../report-page'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createExpense, createExpenseCategory } from '@/db/repositories/expenses'
import { createOrder, type OrderLineDraft } from '@/db/repositories/orders'
import { installTestDevice, testGid } from '@/test-fixtures'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()
const at = (day: number, hour = 10) => new Date(2026, 7, day, hour).getTime()

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
      <ReportPage />
    </MemoryRouter>,
  )

const box = (label: string) => screen.getByText(label).parentElement as HTMLElement

const item = (name: string, unitPrice: number, costPrice: number | null, qty = 1): OrderLineDraft => ({
  itemId: null,
  name,
  unit: 'phần',
  unitPrice,
  costPrice,
  qty,
})

async function sell(
  soldAt: number,
  lines: OrderLineDraft[],
  options: { paid?: number; customerId?: number } = {},
) {
  const total = lines.reduce((sum, line) => sum + Math.round(line.unitPrice * line.qty), 0)
  const paid = options.paid ?? total
  return createOrder({
    customerId: options.customerId ?? null,
    customerName: options.customerId === undefined ? 'Khách lẻ' : 'Chị Hoa',
    lines,
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: paid > 0 ? { amount: paid, method: 'cash', note: '' } : null,
  })
}

describe('màn báo cáo', () => {
  it('lợi nhuận = doanh thu − giá vốn − chi phí, và viết rõ công thức đang dùng', async () => {
    await sell(at(3), [item('Phở bò', 55_000, 30_000, 4)]) // 220.000, vốn 120.000
    await sell(at(5), [item('Trà đá', 3_000, 500, 10)]) //     30.000, vốn 5.000
    await createExpense({ categoryId: null, amount: 80_000, note: 'Gas', spentAt: at(4) })

    renderPage()

    // 250.000 − 125.000 − 80.000 = 45.000
    expect(await screen.findByText('45.000 đ')).toBeDefined()
    expect(screen.getByText('LỢI NHUẬN THÁNG 8/2026')).toBeDefined()
    expect(screen.getByText(/Doanh thu 250\.000 − Giá vốn 125\.000 − Chi phí 80\.000/)).toBeDefined()
    expect(within(box('DOANH THU')).getByText('250.000')).toBeDefined()
    expect(within(box('GIÁ VỐN')).getByText('125.000')).toBeDefined()
    expect(within(box('CHI PHÍ')).getByText('80.000')).toBeDefined()
  })

  it('chi nhiều hơn thu → gọi thẳng là LỖ, không tô xanh một số âm', async () => {
    await sell(at(3), [item('Phở bò', 55_000, null, 1)])
    await createExpense({ categoryId: null, amount: 500_000, note: 'Thuê', spentAt: at(4) })

    renderPage()

    const label = await screen.findByText('LỖ THÁNG 8/2026')
    expect(label.className).toContain('text-danger')
    expect(within(label.parentElement as HTMLElement).getByText('445.000 đ')).toBeDefined()
  })

  it('kỳ rỗng → mọi số về 0 và có empty state, không NaN', async () => {
    renderPage()

    expect(await screen.findByText(/chưa có đơn nào và cũng chưa ghi khoản chi nào/)).toBeDefined()
    expect(within(box('DOANH THU')).getByText('0')).toBeDefined()
    expect(within(box('CHI PHÍ')).getByText('0')).toBeDefined()
    expect(screen.getByText('0 đ')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('bán nợ: doanh thu tính đủ ngay, đã thu chỉ bằng tiền cầm — kèm câu giải thích', async () => {
    const customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
    await sell(at(3), [item('Phở bò', 55_000, null, 4)], { paid: 50_000, customerId })

    renderPage()

    await waitFor(() => expect(within(box('DOANH THU')).getByText('220.000')).toBeDefined())
    expect(within(box('ĐÃ THU')).getByText('50.000')).toBeDefined()
    expect(screen.getByText(/chênh 170\.000 đ là khách còn nợ kỳ này/)).toBeDefined()
  })

  it('thu tiền nợ của đơn kỳ trước → đã thu vượt doanh thu, nói rõ vì sao', async () => {
    const customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
    // Đơn bán từ tháng 7, khách trả nốt trong tháng 8.
    const { id } = await sell(new Date(2026, 6, 20, 10).getTime(), [item('Phở bò', 55_000, null, 4)], {
      paid: 20_000,
      customerId,
    })
    await db.payments.add({
      gid: testGid(999),
      orderId: id,
      allocatedOrderId: id,
      customerId,
      amount: 200_000,
      method: 'cash',
      paidAt: at(3),
      note: '',
    })

    renderPage()

    expect(await screen.findByText(/“Đã thu” cao hơn “Doanh thu” 200\.000 đ vì kỳ này có thu tiền nợ/)).toBeDefined()
  })

  it('vừa khai giá nhập vừa ghi chi phí Nguyên liệu → cảnh báo trừ hai lần', async () => {
    const categoryId = await createExpenseCategory({ name: 'Nguyên liệu' })
    await sell(at(3), [item('Phở bò', 55_000, 30_000, 1)])
    await createExpense({ categoryId, amount: 500_000, note: 'Chợ', spentAt: at(3) })

    renderPage()

    expect(await screen.findByText(/Tiền hàng có thể bị trừ hai lần/)).toBeDefined()
  })

  it('chi phí loại khác không kích cảnh báo trừ hai lần', async () => {
    const categoryId = await createExpenseCategory({ name: 'Thuê' })
    await sell(at(3), [item('Phở bò', 55_000, 30_000, 1)])
    await createExpense({ categoryId, amount: 2_000_000, note: 'Tiền nhà', spentAt: at(3) })

    renderPage()

    await screen.findByText('LỖ THÁNG 8/2026')
    expect(screen.queryByText(/trừ hai lần/)).toBeNull()
  })

  it('thiếu giá nhập → nói rõ bao nhiêu phần trăm tiền hàng chưa có, tính theo tiền', async () => {
    await sell(at(3), [item('Phở bò', 90_000, 30_000, 1), item('Trà đá', 10_000, null, 1)])

    renderPage()

    expect(await screen.findByText(/10% tiền hàng chưa có giá nhập/)).toBeDefined()
  })

  it('bảng bán chạy: ẩn lãi ở món thiếu giá nhập thay vì khoe lãi ảo', async () => {
    await sell(at(3), [item('Phở bò', 55_000, 30_000, 2), item('Trà đá', 3_000, null, 5)])

    renderPage()

    const pho = (await screen.findByText('Phở bò')).closest('div') as HTMLElement
    expect(within(pho).getByText('SL 2 · lãi 50.000')).toBeDefined()
    const tra = screen.getByText('Trà đá').closest('div') as HTMLElement
    expect(within(tra).getByText('SL 5 · chưa có giá nhập')).toBeDefined()
  })

  it('đổi kỳ: "Hôm nay" chỉ tính đơn hôm nay', async () => {
    await sell(at(3), [item('Phở bò', 55_000, null, 1)])
    await sell(at(7), [item('Trà đá', 3_000, null, 10)])

    renderPage()
    await waitFor(() => expect(within(box('DOANH THU')).getByText('85.000')).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: 'Hôm nay' }))

    await waitFor(() => expect(within(box('DOANH THU')).getByText('30.000')).toBeDefined())
    expect(screen.getByText('LỢI NHUẬN HÔM NAY')).toBeDefined()
    // Chọn kỳ khác thì không còn chỗ nào để bấm lùi tháng nữa.
    expect(screen.queryByRole('button', { name: 'Tháng trước' })).toBeNull()
  })

  it('kỳ tuỳ chọn: chỉ tính đúng khoảng ngày đã chọn', async () => {
    await sell(at(1), [item('Phở bò', 55_000, null, 1)])
    await sell(at(4), [item('Bún bò', 60_000, null, 1)])
    await sell(at(7), [item('Trà đá', 3_000, null, 10)])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn' }))

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-08-03' } })
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-08-05' } })
    await userEvent.click(screen.getByRole('button', { name: 'XEM BÁO CÁO' }))

    await waitFor(() => expect(within(box('DOANH THU')).getByText('60.000')).toBeDefined())
    expect(screen.getByText('LỢI NHUẬN 03/08 – 05/08/2026')).toBeDefined()
  })

  it('kỳ tuỳ chọn: chặn xem khi ngày đầu nằm sau ngày cuối', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Tuỳ chọn' }))

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2026-08-06' } })
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2026-08-02' } })

    const view = screen.getByRole('button', { name: 'XEM BÁO CÁO' })
    expect((view as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Ngày đầu đang sau ngày cuối.')).toBeDefined()
    // Không cho chọn ngày chưa tới.
    expect((screen.getByLabelText('Đến ngày') as HTMLInputElement).max).toBe('2026-08-07')
  })

  it('biểu đồ luôn là 7 cột, kể cả khi kỳ đang xem chỉ có một ngày', async () => {
    await sell(at(7), [item('Trà đá', 3_000, null, 10)])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Hôm nay' }))
    await screen.findByText('LỢI NHUẬN HÔM NAY')

    const chart = screen.getByText('7 ngày gần nhất').closest('section') as HTMLElement
    expect(within(chart).getAllByRole('listitem')).toHaveLength(7)
  })

  it('card công nợ tính trên toàn bộ đơn chưa trả đủ, không riêng kỳ đang xem', async () => {
    const customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
    // Đơn nợ nằm ở tháng 7, nhưng vẫn là tiền chưa đòi được hôm nay.
    await sell(new Date(2026, 6, 20, 10).getTime(), [item('Phở bò', 55_000, null, 4)], {
      paid: 20_000,
      customerId,
    })

    renderPage()

    expect(await screen.findByText('KHÁCH CÒN NỢ')).toBeDefined()
    expect(within(box('KHÁCH CÒN NỢ')).getByText('200.000 đ')).toBeDefined()
    expect(screen.getByText(/1 khách · tính trên toàn bộ đơn chưa trả đủ/)).toBeDefined()
  })

  it('đơn huỷ không lọt vào doanh thu, giá vốn hay bảng bán chạy', async () => {
    await sell(at(3), [item('Phở bò', 55_000, 30_000, 1)])
    const { id } = await sell(at(4), [item('Bò Kobe', 999_000, 800_000, 1)])
    await db.orders.update(id, { status: 'void', paidAmount: 0 })

    renderPage()

    await waitFor(() => expect(within(box('DOANH THU')).getByText('55.000')).toBeDefined())
    expect(within(box('GIÁ VỐN')).getByText('30.000')).toBeDefined()
    expect(screen.queryByText('Bò Kobe')).toBeNull()
  })
})
