// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptPage } from '../receipt-page'
import { db } from '@/db/db'
import { createItem, updateItem } from '@/db/repositories/items'
import { createOrder } from '@/db/repositories/orders'
import { collectDebt, listCustomerPayments } from '@/db/repositories/payments'
import { saveShop } from '@/db/repositories/settings'
import { renderReceiptPng } from '../share-receipt'
import { installTestDevice, testGid } from '@/test-fixtures'

const soldAt = new Date(2026, 7, 7, 14, 32).getTime()

// html-to-image cần canvas thật; jsdom không có. Ảnh không phải thứ màn này chịu trách nhiệm tạo ra —
// nó chỉ phải xử lý ĐÚNG kết quả trả về, nên chặn ở ranh giới đó và đo ảnh thật trên trình duyệt.
// Đếm số lần `useReceipt` thật sự chạy lại truy vấn. Ca "chống chụp thừa" mà không có bằng chứng
// này thì xanh giả: nó không phân biệt được "chữ ký ổn định nên không chụp lại" với "liveQuery
// chẳng buồn chạy lại nên chẳng có gì để chụp".
vi.mock('@/db/repositories/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/repositories/payments')>()
  return { ...actual, listCustomerPayments: vi.fn(actual.listCustomerPayments) }
})

vi.mock('../share-receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../share-receipt')>()
  return {
    ...actual,
    renderReceiptPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  vi.stubGlobal('navigator', Object.create(navigator))
})

async function seedOrder(overrides: { qty?: number; paid?: number } = {}) {
  const itemId = await createItem({
    name: 'Phở bò',
    groupId: null,
    unit: 'tô',
    unitPrice: 55_000,
    costPrice: 30_000,
    isActive: 1,
  })
  const { id } = await createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: [
      { itemId, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: overrides.qty ?? 2 },
    ],
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: { amount: overrides.paid ?? 110_000, method: 'cash', note: '' },
  })
  return { id, itemId }
}

function renderReceipt(id: number) {
  return render(
    <MemoryRouter initialEntries={[`/don/${id}/phieu`]}>
      <Routes>
        <Route path="/don/:id/phieu" element={<ReceiptPage />} />
        <Route path="/don/:id" element={<p>Chi tiết đơn</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const shareButton = () => screen.findByRole('button', { name: /CHIA SẺ QUA ZALO/ })

describe('màn phiếu', () => {
  it('hiện đúng số phiếu, dòng hàng và tổng tiền', async () => {
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByText('PHIẾU BÁN HÀNG')).toBeDefined()
    expect(screen.getByText('Số: PBH-260807-A001')).toBeDefined()
    expect(screen.getByText('07/08/2026 14:32')).toBeDefined()

    const totalRow = screen.getByText('Tổng cộng').parentElement as HTMLElement
    expect(within(totalRow).getByText('110.000 đ')).toBeDefined()
    const paidRow = screen.getByText('Đã trả (tiền mặt)').parentElement as HTMLElement
    expect(within(paidRow).getByText('110.000 đ')).toBeDefined()
  })

  it('chưa đặt tên quán → không in dòng trống, mà mời thêm tên quán', async () => {
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByRole('link', { name: /Thêm tên quán vào phiếu/ })).toBeDefined()
  })

  it('đã đặt tên quán → in tên, địa chỉ, số điện thoại lên đầu phiếu', async () => {
    await saveShop({ name: 'Quán Cô Ba', address: '12 Nguyễn Trãi, Q.5', phone: '0909 123 456' })
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByText('Quán Cô Ba')).toBeDefined()
    expect(screen.getByText('12 Nguyễn Trãi, Q.5')).toBeDefined()
    expect(screen.queryByRole('link', { name: /Thêm tên quán/ })).toBeNull()
  })

  it('đơn trả thiếu → phiếu ghi rõ "Còn nợ"', async () => {
    const customerId = await db.customers.add({
      gid: testGid(101),
      name: 'Chị Hoa',
      phone: '',
      address: '',
      note: '',
      createdAt: soldAt,
      updatedAt: soldAt,
    })
    const { id } = await createOrder({
      customerId,
      customerName: 'Chị Hoa',
      lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 2 }],
      discount: 0,
      surcharge: 0,
      soldAt,
      note: '',
      payment: { amount: 40_000, method: 'cash', note: '' },
    })
    renderReceipt(id)

    expect(await screen.findByText('Còn nợ')).toBeDefined()
    expect(screen.getByText('70.000 đ')).toBeDefined()
  })

  it('sửa giá mặt hàng sau khi bán → phiếu cũ giữ nguyên giá lúc bán', async () => {
    const { id, itemId } = await seedOrder()
    await updateItem(itemId, { unitPrice: 80_000 })

    renderReceipt(id)

    const receipt = await screen.findByText('PHIẾU BÁN HÀNG')
    const view = receipt.closest('.receipt-view') as HTMLElement
    expect(within(view).getByText('55.000')).toBeDefined()
    expect(within(view).queryByText('80.000')).toBeNull()
  })

  it('máy chia sẻ được file → gọi navigator.share với đúng ảnh PNG', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve())
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { canShare: () => true, share }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await shareButton())

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    const shared = share.mock.calls[0]?.[0].files
    expect(shared?.[0]?.name).toBe('PBH-260807-A001.png')
    expect(shared?.[0]?.type).toBe('image/png')
  })

  it('người dùng bấm back giữa lúc chia sẻ → không hiện thông báo lỗi nào', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const share = vi.fn(() => Promise.reject(abort))
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { canShare: () => true, share }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await shareButton())

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('máy không chia sẻ được file → đổi hẳn sang tải ảnh, không có nút chia sẻ treo vô dụng', async () => {
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { canShare: () => false }))
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByRole('button', { name: /TẢI ẢNH PHIẾU/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /CHIA SẺ QUA ZALO/ })).toBeNull()
    // Không share được ảnh thì phải còn đường dán chữ vào Zalo.
    expect(screen.getByRole('button', { name: /Chép nội dung/ })).toBeDefined()
  })

  it('máy không có Web Share API → vẫn tải ảnh được, không văng lỗi', async () => {
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByRole('button', { name: /TẢI ẢNH PHIẾU/ })).toBeDefined()
  })

  it('đơn không tồn tại → báo rõ thay vì màn trắng', async () => {
    renderReceipt(999)

    expect(await screen.findByText(/Không tìm thấy đơn/)).toBeDefined()
  })
})

async function seedLongOrder(lineCount: number) {
  const { id } = await createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: Array.from({ length: lineCount }, (_, index) => ({
      itemId: null,
      name: `Món ${index + 1}`,
      unit: 'phần',
      unitPrice: 10_000,
      costPrice: null,
      qty: 1,
    })),
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: { amount: 10_000 * lineCount, method: 'cash', note: '' },
  })
  return id
}

describe('phiếu dài chia thành nhiều tấm ảnh', () => {
  it('11 dòng → 2 trang chia đều, mỗi trang tự giới thiệu mình là trang mấy', async () => {
    renderReceipt(await seedLongOrder(11))

    expect(await screen.findByText('Trang 1/2 · còn tiếp')).toBeDefined()
    expect(screen.getByText('Trang 2/2')).toBeDefined()
    expect(screen.getAllByText('PHIẾU BÁN HÀNG')).toHaveLength(2)

    // Chia đều: 6 + 5, không phải 10 + 1.
    const views = document.querySelectorAll('.receipt-view')
    expect(within(views[0] as HTMLElement).getAllByText(/^Món \d+$/)).toHaveLength(6)
    expect(within(views[1] as HTMLElement).getAllByText(/^Món \d+$/)).toHaveLength(5)
  })

  it('khối tiền chỉ nằm ở trang cuối — trang giữa mà có "Tổng cộng" là sai phiếu', async () => {
    renderReceipt(await seedLongOrder(11))

    await screen.findByText('Trang 2/2')
    const views = document.querySelectorAll('.receipt-view')
    expect(within(views[0] as HTMLElement).queryByText('Tổng cộng')).toBeNull()
    expect(within(views[1] as HTMLElement).getByText('Tổng cộng')).toBeDefined()
  })

  it('chia sẻ phiếu nhiều trang → gửi đủ số tấm, đánh số theo thứ tự đọc', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve())
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { canShare: () => true, share }))
    renderReceipt(await seedLongOrder(11))

    await userEvent.click(await screen.findByRole('button', { name: /CHIA SẺ QUA ZALO \(2 tấm\)/ }))

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    const shared = share.mock.calls[0]?.[0].files
    expect(shared?.map((file) => file.name)).toEqual(['PBH-260807-A001-1.png', 'PBH-260807-A001-2.png'])
  })

  it('phiếu một trang giữ nguyên tên theo số phiếu, không bị đánh số thừa', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve())
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { canShare: () => true, share }))
    renderReceipt(await seedLongOrder(4))

    const button = await screen.findByRole('button', { name: /CHIA SẺ QUA ZALO/ })
    expect(button.textContent).not.toMatch(/tấm/)
    await userEvent.click(button)

    await waitFor(() => expect(share).toHaveBeenCalledOnce())
    expect(share.mock.calls[0]?.[0].files?.map((file) => file.name)).toEqual(['PBH-260807-A001.png'])
  })
})

describe('nợ luỹ kế trên phiếu', () => {
  /** Khách có sẵn một đơn nợ cũ 100.000, rồi bán nợ thêm 55.000 — đúng cảnh của chủ quán. */
  async function seedKhachNoCu() {
    const customerId = await db.customers.add({
      gid: testGid(202),
      name: 'Anh Hùng',
      phone: '',
      address: '',
      note: '',
      createdAt: soldAt,
      updatedAt: soldAt,
    })
    await createOrder({
      customerId,
      customerName: 'Anh Hùng',
      lines: [{ itemId: null, name: 'Cơm tấm', unit: 'đĩa', unitPrice: 150_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: soldAt - 86_400_000,
      note: '',
      payment: { amount: 50_000, method: 'cash', note: '' },
    })
    const { id } = await createOrder({
      customerId,
      customerName: 'Anh Hùng',
      lines: [{ itemId: null, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt,
      note: '',
      payment: null,
    })
    return { id, customerId }
  }

  it('khách còn nợ đơn cũ → phiếu gộp thành một bill có Nợ cũ và TỔNG PHẢI TRẢ', async () => {
    const { id } = await seedKhachNoCu()
    renderReceipt(id)

    expect(await screen.findByText(/^Nợ cũ \(đến /)).toBeDefined()
    const nợCũ = screen.getByText(/^Nợ cũ \(đến /).parentElement as HTMLElement
    expect(within(nợCũ).getByText('100.000 đ')).toBeDefined()

    const tổng = screen.getByText('TỔNG PHẢI TRẢ').parentElement as HTMLElement
    expect(within(tổng).getByText('155.000 đ')).toBeDefined()
  })

  it('thu bớt nợ cũ → phiếu đang mở chụp lại ảnh, không cầm số cũ', async () => {
    // Bẫy CHỤP THIẾU. Thêm ba trường nợ vào phiếu mà quên thêm vào `receiptSignature` thì màn hiện
    // số mới trong khi nút CHIA SẺ vẫn gửi ảnh PNG mang số cũ — khách nhận qua Zalo một tờ sai.
    const { id, customerId } = await seedKhachNoCu()
    renderReceipt(id)

    await screen.findByText('155.000 đ')
    const lầnĐầu = vi.mocked(renderReceiptPng).mock.calls.length

    await collectDebt({ customerId, amount: 40_000, method: 'cash', note: '', paidAt: soldAt })

    await waitFor(() => expect(screen.getByText('115.000 đ')).toBeDefined())
    await waitFor(() => expect(vi.mocked(renderReceiptPng).mock.calls.length).toBeGreaterThan(lầnĐầu))
  })

  it('truy vấn chạy lại mà nợ không đổi trong cùng một phút → không chụp lại thừa', async () => {
    // Bẫy CHỤP THỪA, đối nghịch với ca trên. Bán thêm cho CHÍNH khách này một đơn đã trả đủ: bảng
    // `orders` đổi nên `listOrdersByCustomer` chạy lại thật, nhưng đơn trả đủ không nợ gì nên tổng
    // nợ y nguyên. Để `debtAsOf` nguyên mili-giây thì chữ ký vẫn đổi và phiếu chụp lại ảnh vô ích;
    // máy yếu treo ở "Đang chuẩn bị ảnh…".
    const { id, customerId } = await seedKhachNoCu()
    renderReceipt(id)

    await screen.findByText('155.000 đ')
    await waitFor(() => expect(vi.mocked(renderReceiptPng).mock.calls.length).toBeGreaterThan(0))
    const chụpTrước = vi.mocked(renderReceiptPng).mock.calls.length
    const truyVấnTrước = vi.mocked(listCustomerPayments).mock.calls.length

    await createOrder({
      customerId,
      customerName: 'Anh Hùng',
      lines: [{ itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt,
      note: '',
      payment: { amount: 3_000, method: 'cash', note: '' },
    })

    // Trước hết phải chứng minh liveQuery ĐÃ chạy lại — không thì phần dưới không đo gì cả.
    await waitFor(() =>
      expect(vi.mocked(listCustomerPayments).mock.calls.length).toBeGreaterThan(truyVấnTrước),
    )
    expect(screen.getByText('155.000 đ')).toBeDefined()
    expect(vi.mocked(renderReceiptPng).mock.calls.length).toBe(chụpTrước)
  })
})
