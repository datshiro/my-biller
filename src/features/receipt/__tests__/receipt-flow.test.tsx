// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptPage } from '../receipt-page'
import { buildReceiptRawbtHref } from '../../printer/rawbt-href'
import { db } from '@/db/db'
import { createItem, updateItem } from '@/db/repositories/items'
import { createOrder, voidOrder } from '@/db/repositories/orders'
import { collectDebt, listCustomerPayments } from '@/db/repositories/payments'
import { saveShop } from '@/db/repositories/settings'
import { renderReceiptPng } from '../share-receipt'
import { receiptSignature, type ReceiptData } from '../use-receipt'
import { DEFAULT_SHOP } from '@/domain/schema'
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

// Node ẩn bản nhiệt nhân đôi mọi chữ của phiếu → getByText vấp strict-mode. Bỏ qua CON CHÁU của
// [data-thermal] (không phải chính nó): các ca đếm đúng bản gửi khách, không lẫn bản nhiệt.
configure({ defaultIgnore: 'script, style, [data-thermal] *, [data-label] *' })

// html-to-image cần canvas thật; jsdom không có. Chụp là lười (chỉ khi bấm nút TCP/`.bin`) nên hầu hết
// ca không chạm tới — mock để nếu có chạm thì trả ảnh 576 chấm hợp lệ thay vì ném "getContext".
vi.mock('../../printer/thermal-capture', () => ({
  THERMAL_RATIO: 1.6,
  captureThermal: vi.fn(async () => ({
    width: 576,
    height: 8,
    data: new Uint8ClampedArray(576 * 8 * 4).fill(255),
  })),
}))

// Nút in TCP/`nativeSink` (native) và `<a data-rawbt>` (web Android) đều lệ thuộc nền tảng, Robot không
// lái đủ nhánh trên web. Bật/tắt qua cờ hoisted để kiểm: web thường (0 nút), native (3 kết cục
// onPrintThermal), web Android (1 <a data-rawbt> / guard quá dài).
const sinkShim = vi.hoisted(() => ({
  native: false,
  androidWeb: false,
  sink: vi.fn<(bytes: Uint8Array, cfg: { host: string; port: number }) => Promise<void>>(async () => {}),
}))
vi.mock('../../printer/printer-sink', () => ({
  isNativeApp: () => sinkShim.native,
  isAndroidWeb: () => sinkShim.androidWeb,
  nativeSink: sinkShim.sink,
}))

// Chụp tem cũng cần canvas thật. Màn này chỉ chịu trách nhiệm gọi đúng khổ + đúng số tem; byte TSPL
// được kiểm ở tspl.test.ts và bằng Robot trên Chrome thật.
const labelShim = vi.hoisted(() => ({
  build: vi.fn<(items: readonly { nodes: readonly HTMLElement[]; copies: number }[], size: unknown) => Promise<Uint8Array>>(
    async (items) => new Uint8Array(items.map((item) => item.copies)),
  ),
}))
vi.mock('../../printer/label-job', () => ({ buildLabelJob: labelShim.build }))

// `buildReceiptRawbtHref` chạy `encodePng1`+`CompressionStream` trên canvas thật — jsdom không có. Mock
// trả href hợp lệ; ca "quá dài" override bằng `mockResolvedValueOnce(null)`.
vi.mock('../../printer/rawbt-href', () => ({
  buildReceiptRawbtHref: vi.fn(async () => 'rawbt:data:image/png;base64,AAAA'),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sinkShim.native = false
  sinkShim.androidWeb = false
  sinkShim.sink.mockReset()
  labelShim.build.mockClear()
  try {
    localStorage.removeItem('may-in')
    localStorage.removeItem('may-in-tem')
  } catch {
    /* jsdom */
  }
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

  it('có đúng một bản nhiệt ẩn; trên web không render nút in TCP', async () => {
    const { id } = await seedOrder()
    renderReceipt(id)

    await screen.findByText('PHIẾU BÁN HÀNG')
    expect(document.querySelectorAll('[data-thermal]')).toHaveLength(1)
    // Web thường (không native, không Android): không nút in nào — cả TCP lẫn RawBT.
    expect(document.querySelectorAll('button[data-tcp-print]')).toHaveLength(0)
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)
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
  /** Khách có sẵn một đơn nợ cũ 100.000, rồi bán thêm 55.000 — nợ tiếp hay trả đủ tuỳ `thanhToan`. */
  async function seedKhachNoCu(thanhToan: { amount: number; method: 'cash'; note: string } | null = null) {
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
      payment: thanhToan,
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

  it('đơn này trả đủ mà khách còn nợ cũ → gộp một dòng NỢ CŨ CÒN LẠI, không hai dòng trùng số', async () => {
    // Đơn hôm nay không góp đồng nào vào nợ nên `Nợ cũ` và `TỔNG PHẢI TRẢ` ra đúng một con số. Đây là
    // tờ giấy đưa tận tay khách; hai dòng trùng nhau đọc như lỗi in. Gộp, nhưng KHÔNG bỏ trơn dòng nợ
    // cũ: `TỔNG PHẢI TRẢ` đứng một mình ngay dưới `Đã trả` sẽ bị đọc thành tổng của đơn hôm nay.
    const { id } = await seedKhachNoCu({ amount: 55_000, method: 'cash', note: '' })
    renderReceipt(id)

    const gộp = (await screen.findByText(/^NỢ CŨ CÒN LẠI \(đến /)).parentElement as HTMLElement
    expect(within(gộp).getByText('100.000 đ')).toBeDefined()
    expect(screen.queryByText('TỔNG PHẢI TRẢ')).toBeNull()
    expect(screen.queryByText(/^Nợ cũ \(đến /)).toBeNull()
    // Khối tiền của đơn cũng không được mọc dòng "Còn nợ": đơn này đã trả đủ.
    expect(screen.queryByText('Còn nợ')).toBeNull()
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

describe('receiptSignature', () => {
  const data = (over: Partial<ReceiptData> = {}): ReceiptData => ({
    shop: DEFAULT_SHOP,
    order: {
      id: 1, gid: testGid(1), code: 'A1', originalCode: 'A1', customerId: 1, customerName: 'Anh Hùng', subtotal: 30_000,
      discount: 0, surcharge: 0, total: 30_000, paidAmount: 30_000, status: 'paid', soldAt,
      note: '', createdAt: soldAt, updatedAt: soldAt,
    },
    lines: [],
    payments: [],
    priorDebt: 0,
    totalDue: 0,
    debtAsOf: soldAt,
    ...over,
  })

  it('mốc đọc nợ KHÔNG vào chữ ký khi phiếu không vẽ khối nợ', () => {
    // Chiều ngược của luật "thứ gì in trên phiếu thì phải nằm trong chữ ký": thứ KHÔNG in thì đừng
    // nằm trong chữ ký. `debtAsOf` là đồng hồ sống, nên để nó vào vô điều kiện thì mỗi lần bảng
    // orders/payments đổi ở bất kỳ đâu qua mốc phút là phiếu chụp lại một tờ y nguyên — nút CHIA SẺ
    // nháy về "Đang chuẩn bị ảnh…" giữa lúc người bán đưa máy cho khách.
    const trảĐủ = data()
    expect(receiptSignature(trảĐủ)).toBe(receiptSignature(data({ debtAsOf: soldAt + 60_000 })))
  })

  it('khách có tiền trả trước chưa phân bổ: vẽ khối nợ nhưng KHÔNG in mốc, nên mốc không vào chữ ký', () => {
    // `priorDebt = max(0, totalDue − owingOf(order))` bằng 0 khi khách trả trước nhiều hơn nợ. Khối nợ
    // vẫn vẽ (`TỔNG PHẢI TRẢ` khác `Còn nợ`) nhưng dòng "Nợ cũ (đến HH:mm)" thì không — nên mốc đó
    // không được phép làm phiếu chụp lại. Cổng chữ ký chỉ khớp tầng ngoài là lọt đúng ca này.
    const cóCredit = {
      order: { ...data().order, paidAmount: 0, status: 'unpaid' as const, total: 30_000, subtotal: 30_000 },
      priorDebt: 0,
      totalDue: 5_000,
    }
    expect(receiptSignature(data(cóCredit))).toBe(receiptSignature(data({ ...cóCredit, debtAsOf: soldAt + 60_000 })))
  })

  it('nhưng VẪN vào chữ ký khi mốc đó được in ra', () => {
    // `priorDebt` phải > 0 cùng lúc: đây mới là trạng thái `receiptDebt` dựng ra được
    // (prior = max(0, totalDue − owingOf), mà đơn của `data()` đã trả đủ nên owingOf = 0).
    const đangNợ = { priorDebt: 100_000, totalDue: 100_000 }
    expect(receiptSignature(data(đangNợ))).not.toBe(receiptSignature(data({ ...đangNợ, debtAsOf: soldAt + 60_000 })))
  })
})

// Đường in TCP thật là pha 4 (nativeSink còn ném) và chỉ đo được bằng biên bản pha 5 — Robot không mở
// socket. Nhưng ba nhánh của onPrintThermal (thiếu IP / gửi xong / lỗi) là logic React lái được ở đây.
describe('in máy in nhiệt trong app native', () => {
  const nútIn = () => screen.findByRole('button', { name: /IN MÁY IN NHIỆT/ })
  const xacNhan = () => userEvent.click(screen.getByRole('button', { name: 'In' }))

  it('bấm IN MÁY IN NHIỆT chỉ MỞ hộp xác nhận, chưa gửi gì (chống bấm nhầm)', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútIn())

    expect(screen.getByRole('alertdialog', { name: /In phiếu ra máy in nhiệt/ })).toBeDefined()
    expect(sinkShim.sink).not.toHaveBeenCalled()
  })

  it('chưa cài IP → xác nhận rồi báo "Chưa cài IP máy in" kèm link vào Cài đặt, không gọi sink', async () => {
    sinkShim.native = true
    localStorage.removeItem('may-in')
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútIn())
    await xacNhan()

    expect(await screen.findByText(/Chưa cài IP máy in/)).toBeDefined()
    expect(screen.getByRole('link', { name: /Vào Cài đặt/ })).toBeDefined()
    expect(sinkShim.sink).not.toHaveBeenCalled()
  })

  it('đã cài IP → xác nhận gửi byte thật của phiếu tới đúng máy và báo đã gửi', async () => {
    sinkShim.native = true
    sinkShim.sink.mockResolvedValueOnce(undefined)
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútIn())
    await xacNhan()

    await waitFor(() => expect(sinkShim.sink).toHaveBeenCalledOnce())
    expect(sinkShim.sink.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array)
    expect(sinkShim.sink.mock.calls[0]?.[1]).toEqual({ host: '192.168.1.50', port: 9100 })
    expect(await screen.findByText('Đã gửi tới máy in 192.168.1.50:9100.')).toBeDefined()
  })

  it('huỷ hộp xác nhận → không gửi gì', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútIn())
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(sinkShim.sink).not.toHaveBeenCalled()
  })

  it('máy in lỗi → giữ nguyên câu lỗi thật của sink, không nuốt thành câu chung', async () => {
    sinkShim.native = true
    sinkShim.sink.mockRejectedValueOnce(new Error('Không nối được máy in — máy tắt hoặc khác WiFi.'))
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútIn())
    await xacNhan()

    expect(await screen.findByText('Không nối được máy in — máy tắt hoặc khác WiFi.')).toBeDefined()
  })

  it('bấm-đúp nút "In" trong hộp → chỉ MỘT phiếu gửi đi (khoá ref chống bấm-đúp)', async () => {
    sinkShim.native = true
    sinkShim.sink.mockResolvedValue(undefined)
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)
    await userEvent.click(await nútIn())
    const inBtn = screen.getByRole('button', { name: 'In' })

    // Hai cú chạm NỐI nhau trong một act vào nút "In": hộp chưa kịp đóng (React chưa render lại) — đúng
    // nhịp bấm-đúp đã in HAI tờ trên SPR02 thật. Chỉ khoá ref đồng bộ trong onPrintThermal chặn cú thứ hai.
    await act(async () => {
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(sinkShim.sink).toHaveBeenCalledOnce())
    expect(sinkShim.sink).toHaveBeenCalledOnce()
  })
})

describe('in tem trong app native', () => {
  const temCfg = { host: '192.168.1.60', port: 9100, widthMm: 50, heightMm: 30, gapMm: 2 }
  const nútTem = () => screen.findByRole('button', { name: /IN TEM/ })
  const xacNhanTem = () => userEvent.click(screen.getByRole('button', { name: 'In tem' }))

  it('nút ghi đúng số tem = tổng số lượng, bấm chỉ MỞ hộp xác nhận', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder({ qty: 3, paid: 165_000 })
    renderReceipt(id)

    await userEvent.click(await nútTem())

    expect((await nútTem()).textContent).toContain('IN TEM (3 tem)')
    expect(screen.getByRole('alertdialog', { name: 'In 3 tem cho đơn PBH-260807-A001?' })).toBeDefined()
    expect(screen.getByText('Gửi 3 tem (50×30 mm) tới máy in tem 192.168.1.60:9100.')).toBeDefined()
    expect(sinkShim.sink).not.toHaveBeenCalled()
  })

  it('xác nhận → dựng đúng số tem theo khổ đã cài, gửi tới máy in TEM chứ không phải máy in phiếu', async () => {
    sinkShim.native = true
    sinkShim.sink.mockResolvedValueOnce(undefined)
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder({ qty: 3, paid: 165_000 })
    renderReceipt(id)

    await userEvent.click(await nútTem())
    await xacNhanTem()

    await waitFor(() => expect(sinkShim.sink).toHaveBeenCalledOnce())
    expect(labelShim.build).toHaveBeenCalledOnce()
    const items = labelShim.build.mock.calls[0]?.[0] ?? []
    expect(items.map((item) => item.copies)).toEqual([3])
    // Tem mang tên món của chính dòng đó, không chỉ mã đơn.
    expect(items[0]?.nodes[0]?.textContent).toContain('Phở bò')
    expect(labelShim.build.mock.calls[0]?.[1]).toEqual(temCfg)
    expect(sinkShim.sink.mock.calls[0]?.[1]).toEqual(temCfg)
    expect(await screen.findByText('Đã gửi 3 tem tới máy in 192.168.1.60:9100.')).toBeDefined()
  })

  it('đơn trên 50 phần → hộp xác nhận nhắc kiểm lại số lượng', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder({ qty: 51, paid: 51 * 55_000 })
    renderReceipt(id)

    await userEvent.click(await nútTem())

    expect(screen.getByText(/Nhiều tem — kiểm lại số lượng trước khi in/)).toBeDefined()
  })

  it('chưa cài máy in tem → báo kèm link Cài đặt, không gửi gì', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in', JSON.stringify({ host: '192.168.1.50', port: 9100 }))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútTem())
    await xacNhanTem()

    expect(await screen.findByText(/Chưa cài máy in tem/)).toBeDefined()
    expect(screen.getByRole('link', { name: /MÁY IN TEM/ })).toBeDefined()
    expect(sinkShim.sink).not.toHaveBeenCalled()
  })

  it('máy in tem lỗi → giữ nguyên câu lỗi thật của sink', async () => {
    sinkShim.native = true
    sinkShim.sink.mockRejectedValueOnce(new Error('Máy in không trả lời sau 3 giây.'))
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder()
    renderReceipt(id)

    await userEvent.click(await nútTem())
    await xacNhanTem()

    expect(await screen.findByText('Máy in không trả lời sau 3 giây.')).toBeDefined()
  })

  it('bấm-đúp "In tem" → chỉ MỘT lượt tem gửi đi (bấm đúp không được in gấp đôi số tem)', async () => {
    sinkShim.native = true
    sinkShim.sink.mockResolvedValue(undefined)
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder()
    renderReceipt(id)
    await userEvent.click(await nútTem())
    const inBtn = screen.getByRole('button', { name: 'In tem' })

    await act(async () => {
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      inBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(sinkShim.sink).toHaveBeenCalledOnce())
    expect(labelShim.build).toHaveBeenCalledOnce()
  })

  it('đơn đã huỷ → không có nút IN TEM', async () => {
    sinkShim.native = true
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder()
    await voidOrder(id)
    renderReceipt(id)

    await nútIn()
    expect(screen.queryByRole('button', { name: /IN TEM/ })).toBeNull()
  })

  it('trên web → không có nút IN TEM (tem chỉ đi TCP trong APK)', async () => {
    localStorage.setItem('may-in-tem', JSON.stringify(temCfg))
    const { id } = await seedOrder()
    renderReceipt(id)

    await screen.findByText('PHIẾU BÁN HÀNG')
    expect(screen.queryByRole('button', { name: /IN TEM/ })).toBeNull()
  })

  const nútIn = () => screen.findByRole('button', { name: /IN MÁY IN NHIỆT/ })
})

// Web Android in qua RawBT: nút mở hộp xác nhận; href `rawbt:` dựng sẵn nằm trên nút "In" của hộp (không
// bấm ở test — Robot cũng không bấm). Đo byte ảnh thật để e2e/Robot lo; ở đây chỉ chốt bộ chọn + guard cỡ URL.
describe('in qua RawBT trên web Android', () => {
  it('web Android → nút mở hộp; xác nhận là 1 <a data-rawbt> tiền tố rawbt:, và 0 nút TCP', async () => {
    sinkShim.androidWeb = true
    const { id } = await seedOrder()
    renderReceipt(id)

    const openBtn = await screen.findByRole('button', { name: /IN MÁY IN NHIỆT/ })
    expect(document.querySelectorAll('button[data-tcp-print]')).toHaveLength(0)
    // Chưa mở hộp thì chưa dựng anchor rawbt — tránh điều hướng ngoài ý muốn.
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)

    await userEvent.click(openBtn)

    const link = screen.getByRole('link', { name: 'In' })
    expect(link.getAttribute('href')?.startsWith('rawbt:data:image/png;base64,')).toBe(true)
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(1)
  })

  it('phiếu vượt guard cỡ URL (href null) → dòng "quá dài", không nút in, không <a data-rawbt>', async () => {
    sinkShim.androidWeb = true
    vi.mocked(buildReceiptRawbtHref).mockResolvedValueOnce(null)
    const { id } = await seedOrder()
    renderReceipt(id)

    expect(await screen.findByText(/Phiếu quá dài cho RawBT/)).toBeDefined()
    expect(document.querySelectorAll('a[data-rawbt]')).toHaveLength(0)
  })
})
