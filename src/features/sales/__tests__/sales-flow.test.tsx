// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SalesPage } from '../sales-page'
import { clearCartDraft, loadCartDraft } from '../cart-draft-storage'
import { db } from '@/db/db'
import { savePriceBook } from '@/db/repositories/customer-prices'
import { createCustomer, deleteCustomer } from '@/db/repositories/customers'
import { createItem } from '@/db/repositories/items'
import { getOrderLines } from '@/db/repositories/orders'
import { installTestDevice } from '@/test-fixtures'

/**
 * Đọc bảng giá chậm lại theo từng khách, để dựng được cảnh hai lượt đọc IndexedDB **về sai thứ tự gọi**.
 * Mặc định 0ms nên mọi ca khác chạy y như thật; chỉ ca đua mới nạp số vào map này.
 */
const { chamTheoKhach } = vi.hoisted(() => ({ chamTheoKhach: new Map<number, number>() }))

vi.mock('@/db/repositories/customer-prices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories/customer-prices')>()
  return {
    ...actual,
    listPriceBook: async (customerId: number) => {
      const rows = await actual.listPriceBook(customerId)
      const delay = chamTheoKhach.get(customerId) ?? 0
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      return rows
    },
  }
})

afterEach(cleanup)

beforeEach(async () => {
  localStorage.clear()
  chamTheoKhach.clear()
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
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
        <Route path="/them/mat-hang/moi" element={<p>Màn thêm mặt hàng</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('danh tính máy', () => {
  it('máy chưa có chữ cái bị chặn khỏi màn bán', async () => {
    await db.deviceState.delete('identity')
    renderSales()

    expect(await screen.findByText(/Đặt tên máy trước khi bán/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'ĐẶT TÊN MÁY' })).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Mặt hàng' })).toBeNull()
  })
})

/**
 * Biến nháp app vừa ghi thành nháp **phiên trước** để lại, bằng cách bỏ dấu phiên đi — đúng thứ nằm trên
 * máy người bán sau khi họ đóng app, hoặc sau khi app tự cập nhật lên bản mới.
 *
 * Phải dựng tay như vậy vì trong jsdom `unmount()` rồi `render()` vẫn nằm trong **một** lần nạp trang,
 * tức vẫn cùng một phiên — chính là cảnh "rời màn rồi quay lại" chứ không phải cảnh mở lại app.
 */
function boDauPhienKhoiNhap() {
  const raw = localStorage.getItem('my-biller:cart-draft')
  if (raw === null) throw new Error('Chưa có nháp nào để bỏ dấu phiên.')
  const draft = JSON.parse(raw) as Record<string, unknown>
  delete draft.sessionId
  localStorage.setItem('my-biller:cart-draft', JSON.stringify(draft))
}

/** Chạm ô trong lưới mặt hàng. Phải giới hạn trong lưới vì tên món còn hiện lại ở dòng giỏ. */
const pick = async (name: string) => {
  const grid = await screen.findByRole('group', { name: 'Mặt hàng' })
  await userEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}
const openPayment = async () =>
  userEvent.click(await screen.findByRole('button', { name: /THU TIỀN/ }))

/** Dòng trong giỏ — đơn giá nằm ngay trong nút "Sửa <tên>". */
const dongGio = async (name: string) =>
  (await screen.findByRole('button', { name: `Sửa ${name}` })).textContent ?? ''

const oTrongLuoi = async (name: string) => {
  const grid = await screen.findByRole('group', { name: 'Mặt hàng' })
  return within(grid).getByRole('button', { name: new RegExp(name) }).textContent ?? ''
}

const chonKhach = async (name: string | RegExp) =>
  userEvent.click(await screen.findByRole('button', { name }))

const moChonKhach = async () => userEvent.click(await screen.findByRole('button', { name: /^KHÁCH/ }))

const bam = async (label: string) => userEvent.click(await screen.findByRole('button', { name: label }))

describe('bán hàng', () => {
  it('đã có món rồi vẫn thêm được món mới ngay từ lưới', async () => {
    await seedItems()
    renderSales()

    const grid = await screen.findByRole('group', { name: 'Mặt hàng' })
    // Ô thêm món phải nằm **cuối** lưới: mọi ô khác là một lượt bán, để nó lên đầu là mời chạm nhầm
    // giữa lúc quán đông. Không chốt vị trí ở đây thì dời nó lên đầu vẫn xanh cả bộ.
    expect(within(grid).getAllByRole('button').at(-1)?.textContent).toContain('Thêm mặt hàng')

    await userEvent.click(within(grid).getByRole('button', { name: /Thêm mặt hàng/ }))
    expect(await screen.findByText('Màn thêm mặt hàng')).toBeDefined()
  })

  it('gõ tên món chưa có thì vẫn còn lối tạo món ngay tại chỗ', async () => {
    await seedItems()
    renderSales()

    await userEvent.type(await screen.findByPlaceholderText(/Tìm món/), 'bánh mì')
    expect(await screen.findByText('Không có món nào khớp.')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /Thêm mặt hàng/ }))
    expect(await screen.findByText('Màn thêm mặt hàng')).toBeDefined()
  })

  /**
   * Không có ca Robot: lỗi chỉ hiện trong cửa sổ 300ms giữa lần chạm cuối và lượt ghi nháp. Robot lái
   * trình duyệt thật với đồng hồ thật, mỗi bước tốn hơn 300ms nên nó **luôn** đi qua sau khi nháp đã
   * ghi xong — ca live sẽ xanh kể cả khi lỗi còn nguyên. Gate phải nằm ở đây.
   */
  it('rời màn Bán hàng ngay sau khi thêm món thì nháp giỏ vẫn giữ được món đó', async () => {
    await seedItems()
    const { unmount } = renderSales()

    await pick('Phở bò')
    // Dựng lại đúng cảnh cần kiểm: chưa có gì trên đĩa, giỏ mới nhất chỉ còn trong bộ nhớ. Xoá ở đây
    // thay vì đo bằng đồng hồ, để ca không phụ thuộc việc userEvent chạy nhanh hay chậm hơn 300ms.
    clearCartDraft()
    unmount()

    expect(loadCartDraft()?.cart.lines).toHaveLength(1)
  })

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

    // Quay lại thu tiền thì vẫn phải đang là "Bán nợ". Không được chọn lại — chọn lại là che mất
    // đúng cái bug này: đi chọn khách xong sheet về mặc định tiền mặt và đơn nợ bị ghi thành đã thu đủ.
    expect(screen.getByRole('button', { name: 'Bán nợ' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => {
      expect((await db.orders.toArray())[0]).toMatchObject({ paidAmount: 0, status: 'unpaid' })
    })
    expect(await db.payments.count()).toBe(0)
  })

  it('trả thiếu rồi mới chọn khách: số khách đã đưa giữ nguyên, phần thiếu thành nợ', async () => {
    await seedItems()
    const customerId = await createCustomer({ name: 'Anh Hùng', phone: '', address: '', note: '' })
    renderSales()

    await pick('Phở bò')
    await openPayment()

    const given = within(screen.getByRole('dialog')).getByLabelText('Khách đưa')
    await userEvent.clear(given)
    await userEvent.type(given, '20000')

    await userEvent.click(screen.getByRole('button', { name: /CHỌN KHÁCH ĐỂ GHI NỢ/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Anh Hùng/ }))

    expect(await screen.findByText('Còn nợ lại')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => {
      expect((await db.orders.toArray())[0]).toMatchObject({
        total: 55_000,
        paidAmount: 20_000,
        status: 'partial',
        customerId,
      })
    })
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

  /**
   * `OrderLineDraft.note` cố ý optional để không phải sửa ~25 file test, nên TypeScript KHÔNG ép call
   * site nhớ truyền. Chốt chặn phải là ca hành vi như ca này: gõ ghi chú ở sheet rồi đọc lại sổ.
   */
  it('ghi chú gõ trong sheet sửa dòng theo đơn xuống sổ; dòng bỏ trống là chuỗi rỗng', async () => {
    await seedItems()
    renderSales()

    await pick('Phở bò')
    await pick('Trà đá')
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa Phở bò' }))
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Ghi chú'), 'ít hành')
    await userEvent.click(screen.getByRole('button', { name: 'XONG' }))

    await openPayment()
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))

    await waitFor(async () => expect(await db.orders.count()).toBe(1))

    const [order] = await db.orders.toArray()
    const lines = await getOrderLines(order?.id ?? -1)
    expect(lines.find((line) => line.name === 'Phở bò')?.note).toBe('ít hành')
    expect(lines.find((line) => line.name === 'Trà đá')?.note).toBe('')
  })

  /**
   * Nháp sống sót qua một lượt bán là mầm của đơn trùng: lần mở màn Bán hàng sau đó, đúng những món
   * vừa bán lại nằm sẵn trong giỏ kèm banner "đã khôi phục", và người bán rất dễ bấm bán lần nữa.
   */
  it('bán xong thì nháp biến mất, mở lại không khôi phục đơn vừa bán', async () => {
    await seedItems()
    const first = renderSales()

    await pick('Phở bò')
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).not.toBeNull())

    await openPayment()
    await userEvent.click(screen.getByRole('button', { name: /XONG & XUẤT PHIẾU/ }))
    await screen.findByText('Phiếu đã xuất')

    expect(localStorage.getItem('my-biller:cart-draft')).toBeNull()

    first.unmount()
    renderSales()
    expect(screen.queryByText(/Đã khôi phục đơn đang lên dở/)).toBeNull()
  })

  it('đơn đang lên dở được khôi phục sau khi app bị tắt', async () => {
    await seedItems()
    const first = renderSales()

    await pick('Phở bò')
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).not.toBeNull())

    first.unmount()
    boDauPhienKhoiNhap()
    renderSales()

    expect(await screen.findByText(/Đã khôi phục đơn đang lên dở/)).toBeDefined()
    expect(await screen.findByRole('button', { name: /THU TIỀN · 1 món/ })).toBeDefined()
  })

  /**
   * Bấm sang màn khác rồi quay lại là chuyện xảy ra cả chục lần mỗi buổi — thêm một món, xem lại đơn cũ.
   * Trước đây lần nào cũng dựng lại banner "đã khôi phục", một câu sai sự thật đặt ngay cạnh nút "Bỏ đi"
   * xoá sạch giỏ đang lên.
   */
  it('rời màn Bán hàng rồi quay lại không phải là khôi phục đơn', async () => {
    await seedItems()
    const first = renderSales()

    await pick('Phở bò')
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).not.toBeNull())

    first.unmount()
    renderSales()

    expect(await screen.findByRole('button', { name: /THU TIỀN · 1 món/ })).toBeDefined()
    expect(screen.queryByText(/Đã khôi phục đơn đang lên dở/)).toBeNull()
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

describe('công tắc Lẻ/SỈ', () => {
  /** Phở bò có giá riêng, Trà đá thì không — để thấy SỈ chỉ đụng đúng món có giá riêng. */
  const seedGiaSi = async (name: string, phoPrice: number) => {
    const [phoId] = await seedItems()
    const customerId = await createCustomer({ name, phone: '', address: '', note: '' })
    await savePriceBook(customerId, [{ itemId: phoId ?? -1, unitPrice: phoPrice }])
    return { phoId: phoId ?? -1, customerId }
  }

  it('bật SỈ khi giỏ đã có món: dòng danh mục xuống giá sỉ, dòng gõ tay giữ nguyên', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await pick('Trà đá')

    // Trà đá thành dòng gõ tay — `applyPriceMode` không được đụng vào nó.
    await bam('Sửa Trà đá')
    const priceBox = within(screen.getByRole('dialog')).getByLabelText(/Đơn giá riêng/)
    await userEvent.clear(priceBox)
    await userEvent.type(priceBox, '2000')
    await bam('XONG')

    await bam('SỈ')
    await chonKhach(/Cô Bảy/)

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))
    expect(await dongGio('Trà đá')).toContain('2.000')
    expect(screen.getByText(/1 món lấy giá riêng/)).toBeDefined()

    await openPayment()
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => expect(await db.orders.count()).toBe(1))
    const [order] = await db.orders.toArray()
    expect(order?.total).toBe(47_000)
    expect(await getOrderLines(order?.id ?? -1)).toMatchObject([{ unitPrice: 45_000 }, { unitPrice: 2_000 }])
  })

  it('chạm SỈ khi chưa chọn khách thì phải chọn khách trước; đóng lại vẫn là Lẻ', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')

    expect(await screen.findByText('Chọn khách')).toBeDefined()
    await bam('Đóng')

    expect(screen.getByRole('button', { name: 'SỈ' }).getAttribute('aria-pressed')).toBe('false')
    expect(await dongGio('Phở bò')).toContain('55.000')
  })

  it('thêm món khi đang SỈ — cả qua lưới lẫn qua gõ "2 pho" — đều vào giá riêng', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'SỈ' }).getAttribute('aria-pressed')).toBe('true'))

    // Lưới phải hiện giá SẼ tính, không phải giá lẻ — người bán đọc con số đó rồi mới quyết định bán.
    await waitFor(async () => expect(await oTrongLuoi('Phở bò')).toContain('45.000'))

    await pick('Phở bò')
    expect(await dongGio('Phở bò')).toContain('45.000')

    await userEvent.type(await screen.findByLabelText(/Tìm món/), '2 pho{Enter}')

    await waitFor(async () => expect(await db.orders.count()).toBe(0))
    expect(await screen.findByRole('button', { name: /THU TIỀN · 3 món/ })).toBeDefined()

    await openPayment()
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => expect(await db.orders.count()).toBe(1))
    const [order] = await db.orders.toArray()
    expect(order?.total).toBe(135_000)
    expect(await getOrderLines(order?.id ?? -1)).toMatchObject([{ unitPrice: 45_000, qty: 3 }])
  })

  /**
   * Giá lẻ mà `applyPriceMode` rơi về là ảnh chụp trên dòng giỏ, không phải giá đọc lại từ danh mục.
   * Sửa giá ở màn Mặt hàng giữa chừng mà giỏ nhảy theo là sửa giá một đơn đã chốt giá với khách.
   */
  it('tắt SỈ trả giỏ về đúng giá lẻ lúc thêm món, kể cả khi giá trong danh mục đã đổi', async () => {
    const { phoId } = await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))

    await db.items.update(phoId, { unitPrice: 60_000 })

    await moChonKhach()
    await chonKhach(/Khách lẻ/)

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('55.000'))
    expect(screen.getByRole('button', { name: 'SỈ' }).getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * Khoá dòng có `#priceSource` là vì đúng ca này: không có nó thì dòng catalog vừa xuống 45.000 trùng
   * khoá dòng gõ tay 45.000 → `upsert` gộp thành một dòng `manual` qty 2. Tắt SỈ không đụng dòng manual,
   * nên cả 2 tô bán 45.000 thay vì 1×45.000 + 1×55.000 — mất tiền mà không lỗi nào hiện ra.
   */
  it('dòng gõ tay trùng giá với giá sỉ vẫn là hai dòng riêng, tắt SỈ thì tách lại đúng', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await bam('Sửa Phở bò')
    const priceBox = within(screen.getByRole('dialog')).getByLabelText(/Đơn giá riêng/)
    await userEvent.clear(priceBox)
    await userEvent.type(priceBox, '45000')
    await bam('XONG')

    await pick('Phở bò')
    expect(await screen.findByRole('button', { name: /THU TIỀN · 2 món/ })).toBeDefined()

    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sửa Phở bò' })).toHaveLength(2))

    await moChonKhach()
    await chonKhach(/Khách lẻ/)

    await openPayment()
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => expect(await db.orders.count()).toBe(1))
    const [order] = await db.orders.toArray()
    expect(order?.total).toBe(100_000)
    expect(await getOrderLines(order?.id ?? -1)).toMatchObject([
      { unitPrice: 45_000, qty: 1 },
      { unitPrice: 55_000, qty: 1 },
    ])
  })

  it('món đã ngừng bán còn nằm trong giỏ thì bật/tắt SỈ vẫn chạy, không đổi giá bậy', async () => {
    const { phoId } = await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await db.items.update(phoId, { isActive: 0 })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sửa Phở bò/ })).not.toBeNull())

    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))

    await moChonKhach()
    await chonKhach(/Khách lẻ/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('55.000'))
  })

  it('đổi khách khi đang SỈ thì mọi đơn giá là giá của khách mới', async () => {
    const { phoId } = await seedGiaSi('Cô Bảy', 45_000)
    const chuTam = await createCustomer({ name: 'Chú Tám', phone: '', address: '', note: '' })
    await savePriceBook(chuTam, [{ itemId: phoId, unitPrice: 30_000 }])
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))

    await moChonKhach()
    await chonKhach(/Chú Tám/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('30.000'))

    await openPayment()
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => expect(await db.orders.count()).toBe(1))
    const [order] = await db.orders.toArray()
    expect(order).toMatchObject({ customerId: chuTam, total: 30_000 })
    expect(await getOrderLines(order?.id ?? -1)).toMatchObject([{ unitPrice: 30_000 }])
  })

  /**
   * Bảng giá của khách trước về SAU bảng giá của khách sau. `await` một mình không chặn được: nó chỉ
   * bảo đảm mỗi lượt đọc xong mới dispatch, không bảo đảm lượt nào xong trước. Bỏ `requestId` đi thì
   * header hiện "Chú Tám" mà từng đơn giá là của Cô Bảy — không một lỗi nào hiện ra.
   */
  it('đổi khách hai nhịp nhanh, bảng giá khách cũ về sau: giá vẫn là của khách đang hiện trên header', async () => {
    const { phoId, customerId: coBay } = await seedGiaSi('Cô Bảy', 45_000)
    const chuTam = await createCustomer({ name: 'Chú Tám', phone: '', address: '', note: '' })
    await savePriceBook(chuTam, [{ itemId: phoId, unitPrice: 30_000 }])
    chamTheoKhach.set(coBay, 300)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await moChonKhach()
    await chonKhach(/Chú Tám/)

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('30.000'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })

    expect(await dongGio('Phở bò')).toContain('30.000')
  })

  /**
   * Bấm lọt THU TIỀN trong cửa sổ `await` là `finish` chụp `cart.lines` của render trước → đơn ghi ở
   * giá **trước khi** tính lại, rồi `reset()` xoá sạch giỏ nên không còn gì để đối chiếu.
   */
  it('nút THU TIỀN bị khoá trong lúc còn đang nạp bảng giá', async () => {
    const { customerId } = await seedGiaSi('Cô Bảy', 45_000)
    chamTheoKhach.set(customerId, 300)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)

    expect((await screen.findByRole('button', { name: /THU TIỀN/ })).hasAttribute('disabled')).toBe(true)

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))
    expect(screen.getByRole('button', { name: /THU TIỀN/ }).hasAttribute('disabled')).toBe(false)
  })

  it('nháp SỈ khôi phục theo bảng giá HIỆN TẠI, không theo giá đã đóng băng trong nháp', async () => {
    const { phoId, customerId } = await seedGiaSi('Cô Bảy', 45_000)
    const first = renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).toContain('45000'))

    first.unmount()
    await savePriceBook(customerId, [{ itemId: phoId, unitPrice: 40_000 }])
    renderSales()

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('40.000'))
    expect(screen.getByRole('button', { name: 'SỈ' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('nháp SỈ trỏ vào khách đã bị xoá: hạ về Lẻ và báo cho người bán', async () => {
    const { customerId } = await seedGiaSi('Cô Bảy', 45_000)
    const first = renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(() => expect(localStorage.getItem('my-biller:cart-draft')).toContain('45000'))

    first.unmount()
    await deleteCustomer(customerId)
    renderSales()

    expect(await screen.findByText(/không còn nữa/)).toBeDefined()
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('55.000'))
    expect(screen.getByRole('button', { name: 'SỈ' }).getAttribute('aria-pressed')).toBe('false')
  })

  /**
   * Đường mất tiền nguy hiểm nhất của plan này: `calcOrderTotals` kẹp `discount` về `subtotal` **trong im
   * lặng**, nên một cú chạm công tắc kéo tổng về 0 và đơn 0đ đó được ghi là trả đủ. Guard `tooBig` của
   * `AdjustSheet` chỉ chạy lúc gõ, không chạy lại sau khi đổi giá.
   */
  it('giảm giá trước rồi bật SỈ: tổng tụt về 0 thì phải có cảnh báo ở thanh tổng', async () => {
    await seedGiaSi('Cô Bảy', 5_000)
    renderSales()

    await pick('Phở bò')
    await bam('Giảm giá / phụ thu')

    const box = within(screen.getByRole('dialog')).getByLabelText('Giảm giá')
    await userEvent.type(box, '50000')
    await bam('ÁP DỤNG')

    await bam('SỈ')
    await chonKhach(/Cô Bảy/)

    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('5.000'))
    expect(screen.getByText(/vẫn còn giảm giá/)).toBeDefined()
    expect(screen.getByRole('button', { name: /THU TIỀN/ })).toBeDefined()
  })

  it('đang SỈ mà mở Giảm giá thì sheet nói rõ đơn này đã tính giá sỉ', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))

    await bam('Giảm giá / phụ thu')
    expect(within(screen.getByRole('dialog')).getByText(/giảm lần thứ hai/)).toBeDefined()
  })

  it('chốt đơn sỉ bằng chuyển khoản: thu đủ theo tổng sỉ, không dính quy tắc "khách đưa"', async () => {
    await seedGiaSi('Cô Bảy', 45_000)
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)
    await waitFor(async () => expect(await dongGio('Phở bò')).toContain('45.000'))

    await openPayment()
    await bam('Chuyển khoản')
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => {
      expect((await db.orders.toArray())[0]).toMatchObject({
        total: 45_000,
        paidAmount: 45_000,
        status: 'paid',
      })
    })
  })

  /**
   * Dòng giá bẩn không có đường vào từ giao diện — `savePriceBook` parse trước khi ghi. Nó tới từ bản
   * build cũ hoặc từ một lần sửa tay qua DevTools. `buildPriceBook` bỏ dòng đó, và ca này khoá cái giá
   * của việc bỏ: món rơi về **giá lẻ**, màn Bán vẫn bán được. Không bỏ thì `unitPrice` bẩn chảy tới
   * `cartTotals` và `assertMoney` ném ngay trong thân render, chiếm màn hình giữa lúc đang bán.
   */
  it('dòng giá bẩn trong DB: món đó về giá lẻ, màn Bán vẫn chạy chứ không sập', async () => {
    const { phoId, customerId } = await seedGiaSi('Cô Bảy', 45_000)
    await db.customerPrices.where('[customerId+itemId]').equals([customerId, phoId]).modify({
      unitPrice: 45_000.5 as unknown as number,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderSales()

    await pick('Phở bò')
    await bam('SỈ')
    await chonKhach(/Cô Bảy/)

    await waitFor(() => expect(screen.getByText(/chưa món nào có giá riêng/)).toBeDefined())
    expect(await dongGio('Phở bò')).toContain('55.000')

    await openPayment()
    await bam('XONG & XUẤT PHIẾU')

    await waitFor(async () => expect((await db.orders.toArray())[0]?.total).toBe(55_000))
    vi.restoreAllMocks()
  })
})

/**
 * Máy trạng thái của ô số lượng (`text` / `lastEmitted` / `qtyAtFocus` × 4 handler) là phần code rắc
 * rối nhất của phase này. Trước đó chỉ Robot canh nó — vòng ~11 phút, cần Chrome thật. Ba ca jsdom
 * dưới đây cho vòng sửa nhanh 15 giây một cổng thật.
 */
describe('ô số lượng trong giỏ', () => {
  const oSoLuong = async (name: string) =>
    (await screen.findByRole('textbox', { name: `Số lượng ${name}` })) as HTMLInputElement

  it('gõ dở "1.000" rồi rời ô thì giữ nguyên số lúc vào ô, không đoán thành 1', async () => {
    await seedItems()
    renderSales()
    await pick('Phở bò')

    const o = await oSoLuong('Phở bò')
    await userEvent.clear(o)
    await userEvent.type(o, '1.000')
    await userEvent.tab()

    // `1.000` không phân xử được giữa "một nghìn" và "một" ⇒ `parseQtyInput` trả `null` ⇒ phải trả về
    // số lúc focus chứ không được đoán. Đoán thành 1 là bán thiếu 999 tô mà không ai thấy.
    expect((await oSoLuong('Phở bò')).value).toBe('1')
    expect(await screen.findByText(/không đọc được/)).toBeTruthy()
  })

  it('xoá trắng ô rồi rời đi thì dòng còn nguyên và ô hiện lại số cũ', async () => {
    await seedItems()
    renderSales()
    await pick('Phở bò')
    await bam('Thêm một')

    const o = await oSoLuong('Phở bò')
    await userEvent.clear(o)
    await userEvent.tab()

    // Ô rỗng là "chưa gõ xong", không phải "bỏ món" — chỉ số `0` gõ rõ ràng mới bỏ món.
    expect((await oSoLuong('Phở bò')).value).toBe('2')
  })

  it('bấm nút cộng khi đang gõ dở thì ô nhảy theo giỏ, không kẹt giá trị cũ', async () => {
    await seedItems()
    renderSales()
    await pick('Phở bò')

    const o = await oSoLuong('Phở bò')
    await userEvent.clear(o)
    await userEvent.type(o, '50')
    await bam('Thêm một')

    // Ô là controlled-text nên phải tự đồng bộ ngược khi giỏ đổi từ chỗ khác; kẹt ở "50" là màn hiện
    // một số mà sổ ghi số khác.
    expect((await oSoLuong('Phở bò')).value).toBe('51')
  })
})
