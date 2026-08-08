// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { addDays, startOfDay } from 'date-fns'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrderDetailPage } from '../order-detail-page'
import { OrderListPage } from '../order-list-page'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createOrder, type OrderDraft } from '@/db/repositories/orders'

afterEach(cleanup)

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

/**
 * Neo vào 10h sáng của ngày chứ không phải "cách đây 2 tiếng": chạy bộ test lúc 00:40 thì "cách đây
 * 2 tiếng" rơi sang hôm qua, nhãn "Hôm nay" biến mất và test đỏ vì đồng hồ chứ không vì mã.
 */
const morningOf = (daysBack: number) => addDays(startOfDay(Date.now()), -daysBack).getTime() + 10 * 3_600_000

const draft = (overrides: Partial<OrderDraft> = {}): OrderDraft => ({
  customerId: null,
  customerName: 'Khách lẻ',
  lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 }],
  discount: 0,
  surcharge: 0,
  soldAt: morningOf(0),
  note: '',
  payment: { amount: 110_000, method: 'cash', note: '' },
  ...overrides,
})

const renderApp = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/don" element={<OrderListPage />} />
        <Route path="/don/:id" element={<OrderDetailPage />} />
        <Route path="/don/:id/phieu" element={<p>Màn phiếu</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('danh sách đơn', () => {
  it('gom theo ngày, mỗi nhóm có tổng tiền của ngày đó', async () => {
    await createOrder(draft())
    await createOrder(draft({ soldAt: morningOf(1), payment: { amount: 110_000, method: 'cash', note: '' } }))
    renderApp('/don')

    expect(await screen.findByText(/Hôm nay ·/)).toBeDefined()
    expect(screen.getByText(/Hôm qua ·/)).toBeDefined()
    // Mỗi nhóm một đơn 110.000 → mỗi nhãn nhóm kèm đúng số đó.
    expect(screen.getAllByText('110.000 đ')).toHaveLength(2)
  })

  it('dòng đơn ghi giờ, số món và hình thức trả', async () => {
    await createOrder(draft())
    renderApp('/don')

    expect(await screen.findByText(/1 món · Tiền mặt/)).toBeDefined()
  })

  it('đơn còn nợ hiện luôn số tiền còn thiếu ngay trên dòng', async () => {
    const customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
    await createOrder(
      draft({ customerId, customerName: 'Chị Hoa', payment: { amount: 40_000, method: 'cash', note: '' } }),
    )
    renderApp('/don')

    expect(await screen.findByText(/Còn nợ 70.000/)).toBeDefined()
  })

  it('đơn đã huỷ vẫn hiện nhưng không cộng vào tổng ngày', async () => {
    const kept = await createOrder(draft())
    const voided = await createOrder(draft())
    await db.orders.update(voided.id, { status: 'void', paidAmount: 0 })
    renderApp('/don')

    await screen.findByText(/Hôm nay ·/)
    expect(screen.getByText('Đã huỷ')).toBeDefined()
    // Chỉ đơn còn hiệu lực vào tổng nhóm — nhãn nhóm là 110.000, không phải 220.000.
    const group = screen.getByText(/Hôm nay ·/).parentElement as HTMLElement
    expect(within(group).getByText('110.000 đ')).toBeDefined()
    expect(kept.id).not.toBe(voided.id)
  })

  it('chưa có đơn nào thì chỉ đường sang màn bán hàng', async () => {
    renderApp('/don')

    expect(await screen.findByText(/Chưa có đơn nào/)).toBeDefined()
  })
})

describe('chi tiết đơn', () => {
  it('huỷ đơn từ giao diện: phải xác nhận, xong thì đơn thành đã huỷ và mất phiếu thu', async () => {
    const { id } = await createOrder(draft())
    renderApp(`/don/${id}`)

    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }))
    // Bấm nhầm vào nút huỷ không được làm mất đơn — phải qua một bước xác nhận.
    expect(screen.getByRole('alertdialog')).toBeDefined()
    expect((await db.orders.get(id))?.status).toBe('paid')

    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Huỷ đơn' }))

    await waitFor(async () => expect((await db.orders.get(id))?.status).toBe('void'))
    expect(await db.payments.where('orderId').equals(id).count()).toBe(0)
    expect(await screen.findByText(/không tính vào doanh thu/)).toBeDefined()
  })

  it('bấm Huỷ trong hộp xác nhận thì đơn còn nguyên', async () => {
    const { id } = await createOrder(draft())
    renderApp(`/don/${id}`)

    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect((await db.orders.get(id))?.status).toBe('paid')
  })

  it('sửa ghi chú rồi lưu → ghi vào đơn', async () => {
    const { id } = await createOrder(draft())
    renderApp(`/don/${id}`)

    await userEvent.type(await screen.findByLabelText('Ghi chú'), 'giao chiều mai')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu ghi chú' }))

    await waitFor(async () => expect((await db.orders.get(id))?.note).toBe('giao chiều mai'))
  })

  it('đơn đã huỷ thì không còn nút huỷ nữa', async () => {
    const { id } = await createOrder(draft())
    await db.orders.update(id, { status: 'void', paidAmount: 0 })
    renderApp(`/don/${id}`)

    await screen.findByText('Đã huỷ')
    expect(screen.queryByRole('button', { name: 'Huỷ đơn' })).toBeNull()
  })
})
