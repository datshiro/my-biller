// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SalesPage } from '../sales-page'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createItem } from '@/db/repositories/items'
import { getOrderLines } from '@/db/repositories/orders'

afterEach(cleanup)

beforeEach(async () => {
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

const seedItems = () =>
  Promise.all([
    createItem({ name: 'Phở bò', groupId: null, unit: 'tô', unitPrice: 55_000, costPrice: 30_000, isActive: 1 }),
    createItem({ name: 'Trà đá', groupId: null, unit: 'ly', unitPrice: 3_000, costPrice: 500, isActive: 1 }),
  ])

function renderSales() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<SalesPage />} />
        <Route path="/don/:id/phieu" element={<p>Phiếu đã xuất</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Chạm ô trong lưới mặt hàng. Phải giới hạn trong lưới vì tên món còn hiện lại ở dòng giỏ. */
const pick = async (name: string) => {
  const grid = await screen.findByRole('group', { name: 'Mặt hàng' })
  await userEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}
const openPayment = async () =>
  userEvent.click(await screen.findByRole('button', { name: /THU TIỀN/ }))

describe('bán hàng', () => {
  it('hai món, khách đưa dư → tiền thối đúng, đơn paid, ghi đủ dòng hàng', async () => {
    await seedItems()
    renderSales()

    await pick('Phở bò')
    await pick('Phở bò')
    await pick('Trà đá')
    await openPayment()

    // 55.000×2 + 3.000 = 113.000 → gợi ý 120.000 / 150.000 / 200.000
    await userEvent.click(screen.getByRole('button', { name: '120.000' }))
    expect(within(screen.getByRole('dialog')).getByText('7.000 đ')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => {
      const orders = await db.orders.toArray()
      expect(orders).toHaveLength(1)
      expect(orders[0]).toMatchObject({ total: 113_000, paidAmount: 113_000, status: 'paid', customerId: null })
    })

    const [order] = await db.orders.toArray()
    expect(await getOrderLines(order?.id ?? -1)).toHaveLength(2)
    // Phiếu thu chỉ ghi số tiền thực nhận, không ghi tiền khách đưa.
    expect((await db.payments.toArray())[0]?.amount).toBe(113_000)
  })

  it('bán nợ cho khách lẻ bị chặn — phải chọn khách trước', async () => {
    await seedItems()
    await createCustomer({ name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '' })
    renderSales()

    await pick('Phở bò')
    await openPayment()
    await userEvent.click(screen.getByRole('button', { name: 'Bán nợ' }))

    expect(screen.getByText(/Nợ phải có chủ/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /XONG & XUẤT PHIẾU/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /CHỌN KHÁCH ĐỂ GHI NỢ/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Anh Hùng/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Bán nợ' }))
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => {
      expect((await db.orders.toArray())[0]).toMatchObject({ paidAmount: 0, status: 'unpaid' })
    })
    expect(await db.payments.count()).toBe(0)
  })

  it('khách trả thiếu → partial, phần thiếu thành nợ của khách đó', async () => {
    await seedItems()
    const customerId = await createCustomer({ name: 'Anh Hùng', phone: '', address: '', note: '' })
    renderSales()

    await userEvent.click(await screen.findByRole('button', { name: /KHÁCH/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Anh Hùng/ }))

    await pick('Phở bò')
    await openPayment()

    const given = within(screen.getByRole('dialog')).getByLabelText('Khách đưa')
    await userEvent.clear(given)
    await userEvent.type(given, '20000')
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => {
      expect((await db.orders.toArray())[0]).toMatchObject({
        total: 55_000,
        paidAmount: 20_000,
        status: 'partial',
        customerId,
      })
    })
    expect((await db.payments.toArray())[0]).toMatchObject({ amount: 20_000, customerId })
  })

  it('bấm Xong hai lần thật nhanh chỉ tạo một đơn', async () => {
    await seedItems()
    renderSales()

    await pick('Phở bò')
    await openPayment()

    // Hai cú click phải nằm TRONG CÙNG một act, tức là trước khi React kịp vẽ lại nút thành disabled —
    // đúng kiểu chạm dính tay khi luồng chính đang bận. fireEvent/userEvent tự bọc act nên
    // sẽ nối tiếp hai click và không dựng lại được cảnh này.
    const done = screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ })
    await act(async () => {
      done.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      done.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await screen.findByText('Phiếu đã xuất')
    expect(await db.orders.count()).toBe(1)
  })

  it('sửa đơn giá một dòng chỉ đổi đơn này, giá trong danh mục giữ nguyên', async () => {
    const [itemId] = await seedItems()
    renderSales()

    await pick('Phở bò')
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa Phở bò' }))

    const priceBox = within(screen.getByRole('dialog')).getByLabelText(/Đơn giá riêng/)
    await userEvent.clear(priceBox)
    await userEvent.type(priceBox, '40000')
    await userEvent.click(screen.getByRole('button', { name: 'XONG' }))

    await openPayment()
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => expect(await db.orders.count()).toBe(1))

    const [order] = await db.orders.toArray()
    expect(await getOrderLines(order?.id ?? -1)).toMatchObject([{ unitPrice: 40_000, amount: 40_000 }])
    expect(order?.total).toBe(40_000)
    expect((await db.items.get(itemId ?? -1))?.unitPrice).toBe(55_000)
  })

  it('đơn đang lên dở được khôi phục sau khi app bị tắt', async () => {
    await seedItems()
    const first = renderSales()

    await pick('Phở bò')
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).not.toBeNull())

    first.unmount()
    renderSales()

    expect(await screen.findByText(/Đã khôi phục đơn đang lên dở/)).toBeDefined()
    expect(await screen.findByRole('button', { name: /THU TIỀN · 1 món/ })).toBeDefined()
  })

  it('nháp hỏng không làm chết màn bán hàng', async () => {
    await seedItems()
    localStorage.setItem('my-biller:cart-draft', '{"lines":[{"qty":"nhiều"}]}')

    renderSales()

    expect(await screen.findByRole('button', { name: /Phở bò/ })).toBeDefined()
    expect(localStorage.getItem('my-biller:cart-draft')).toBeNull()
  })

  it('gõ "2 tra da" rồi Enter thêm đúng 2 Trà đá', async () => {
    await seedItems()
    renderSales()

    await userEvent.type(await screen.findByLabelText(/Tìm món/), '2 tra da{Enter}')

    expect(await screen.findByRole('button', { name: /THU TIỀN · 2 món/ })).toBeDefined()
  })
})
