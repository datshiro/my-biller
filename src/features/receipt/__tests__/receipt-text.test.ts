import { describe, expect, it } from 'vitest'
import { receiptToText } from '../receipt-text'
import { DEFAULT_SHOP, type Order, type OrderLine, type Payment } from '@/domain/schema'
import { testGid } from '@/test-fixtures'

const soldAt = new Date(2026, 7, 7, 14, 32).getTime()

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 1,
  gid: testGid(1),
  code: 'PBH-260807-001',
  originalCode: '',
  customerId: null,
  customerName: 'Khách lẻ',
  subtotal: 113_000,
  discount: 0,
  surcharge: 0,
  total: 113_000,
  paidAmount: 113_000,
  status: 'paid',
  soldAt,
  note: '',
  createdAt: soldAt,
  updatedAt: soldAt,
  ...overrides,
})

const lines: OrderLine[] = [
  { id: 1, gid: testGid(1), orderId: 1, itemId: 1, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 2, amount: 110_000, note: 'ít hành' },
  { id: 2, gid: testGid(2), orderId: 1, itemId: 2, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: null, qty: 1, amount: 3_000, note: '' },
]

/**
 * Ba trường nợ luỹ kế, mặc định là "khách lẻ, không có nợ nào khác". `totalDue` phải bằng đúng số
 * còn nợ của chính đơn thì cổng `totalDue !== remaining` mới đóng — đó là ca của mọi phiếu cũ.
 */
const khongNo = (remaining = 0) => ({ priorDebt: 0, totalDue: remaining, debtAsOf: null })

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 1,
  gid: testGid(1),
  orderId: 1,
  allocatedOrderId: 1,
  customerId: null,
  amount: 113_000,
  method: 'cash',
  paidAt: soldAt,
  note: '',
  ...overrides,
})

describe('receiptToText', () => {
  it('có đủ số phiếu, ngày giờ, từng dòng hàng và tổng tiền', () => {
    const text = receiptToText({ shop: DEFAULT_SHOP, order: order(), lines, payments: [payment()], ...khongNo() })

    expect(text).toContain('Số: PBH-260807-001')
    expect(text).toContain('07/08/2026 14:32')
    // Fixture dòng Phở bò mang sẵn `note: 'ít hành'`. Assert cũ không có ngoặc nên nó xanh dù bản
    // chữ chưa từng in ghi chú — người bếp đọc tin Zalo không thấy thứ người bán đã ghi.
    expect(text).toContain('Phở bò (ít hành) — 2 × 55.000 = 110.000')
    expect(text).toContain('Trà đá — 1 × 3.000 = 3.000')
    expect(text).not.toContain('Trà đá ()')
    expect(text).toContain('TỔNG CỘNG: 113.000 đ')
    expect(text).toContain('Đã trả (tiền mặt): 113.000 đ')
  })

  it('chưa đặt tên quán → không có dòng trống ở đầu', () => {
    const text = receiptToText({ shop: DEFAULT_SHOP, order: order(), lines, payments: [], ...khongNo() })

    expect(text.startsWith('PHIẾU BÁN HÀNG')).toBe(true)
  })

  it('đã đặt tên quán → tên, địa chỉ, số điện thoại lên đầu', () => {
    const text = receiptToText({
      shop: { ...DEFAULT_SHOP, name: 'Quán Cô Ba', address: '12 Nguyễn Trãi', phone: '0909 123 456' },
      order: order(),
      lines,
      payments: [],
      ...khongNo(),
    })

    expect(text.startsWith('Quán Cô Ba\n12 Nguyễn Trãi\n0909 123 456')).toBe(true)
  })

  it('còn nợ thì nói rõ còn nợ bao nhiêu', () => {
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 40_000, status: 'partial', customerName: 'Chị Hoa' }),
      lines,
      payments: [payment({ amount: 40_000 })],
      ...khongNo(73_000),
    })

    expect(text).toContain('CÒN NỢ: 73.000 đ')
  })

  it('có giảm giá / phụ thu thì tách rõ từng khoản, không gộp vào một số', () => {
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ discount: 13_000, surcharge: 5_000, total: 105_000, paidAmount: 105_000 }),
      lines,
      payments: [payment({ amount: 105_000 })],
      ...khongNo(),
    })

    expect(text).toContain('Hàng: 113.000 đ')
    expect(text).toContain('Giảm giá: 13.000 đ')
    expect(text).toContain('Phụ thu: 5.000 đ')
    expect(text).toContain('TỔNG CỘNG: 105.000 đ')
  })

  it('khách đang nợ mà đơn này trả đủ: gộp một dòng NỢ CŨ CÒN LẠI, không in hai dòng trùng số', () => {
    // Anh Hùng nợ 100.000 từ đơn cũ, hôm nay mua 30.000 trả tiền mặt đủ. `owingOf` của đơn này là 0
    // nên đơn này không góp đồng nào vào nợ, và "Nợ cũ" với "TỔNG PHẢI TRẢ" ra đúng một con số. Hai
    // dòng trùng nhau trên giấy đưa khách đọc như lỗi in, nên gộp — nhưng nhãn phải tự nói ra đây là
    // nợ đơn TRƯỚC, vì "TỔNG PHẢI TRẢ" đứng ngay dưới "Đã trả 30.000" thì bị đọc thành tổng đơn này.
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 30_000, status: 'paid', customerId: 1, customerName: 'Anh Hùng', total: 30_000, subtotal: 30_000 }),
      lines,
      payments: [payment({ amount: 30_000 })],
      priorDebt: 100_000,
      totalDue: 100_000,
      debtAsOf: new Date(2026, 7, 7, 14, 32).getTime(),
    })

    expect(text).not.toContain('CÒN NỢ:')
    expect(text).toContain('NỢ CŨ CÒN LẠI (đến 14:32 07/08): 100.000 đ')
    expect(text).not.toContain('TỔNG PHẢI TRẢ')
    expect(text).not.toContain('NỢ CŨ (đến')
  })

  it('khách còn nợ đơn cũ thì có cả NỢ CŨ lẫn TỔNG PHẢI TRẢ, cùng cổng với bản vẽ', () => {
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 0, status: 'unpaid', customerId: 1, customerName: 'Anh Hùng', total: 55_000, subtotal: 55_000 }),
      lines,
      payments: [],
      priorDebt: 100_000,
      totalDue: 155_000,
      debtAsOf: new Date(2026, 7, 7, 14, 32).getTime(),
    })

    expect(text).toContain('CÒN NỢ: 55.000 đ')
    expect(text).toContain('NỢ CŨ (đến 14:32 07/08): 100.000 đ')
    expect(text).toContain('TỔNG PHẢI TRẢ: 155.000 đ')
  })

  it('khách có tiền trả trước nhiều hơn nợ: vẫn in TỔNG PHẢI TRẢ, và KHÔNG in dòng nợ cũ', () => {
    // Ca RT-1. Cổng `priorDebt > 0` sẽ giấu con số đúng lúc phiếu đang đòi thừa tiền: phiếu ghi
    // "Còn nợ 55.000" trong khi khách chỉ thật sự nợ 25.000.
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 0, status: 'unpaid', customerId: 1, customerName: 'Anh Hùng', total: 55_000, subtotal: 55_000 }),
      lines,
      payments: [],
      priorDebt: 0,
      totalDue: 25_000,
      debtAsOf: new Date(2026, 7, 7, 14, 32).getTime(),
    })

    expect(text).toContain('TỔNG PHẢI TRẢ: 25.000 đ')
    expect(text).not.toContain('NỢ CŨ')
  })

  it('không bao giờ in mốc giờ rỗng lên phiếu đưa khách', () => {
    // RT-14. `debtAsOf` từng là sentinel `0`, mà `0` là mốc HỢP LỆ với `format` — nó in
    // "07:00 01/01" lên tờ giấy đưa tận tay khách ngay khi cổng hiển thị đổi theo RT-1.
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 0, status: 'unpaid', customerId: 1, customerName: 'Anh Hùng', total: 55_000, subtotal: 55_000 }),
      lines,
      payments: [],
      priorDebt: 0,
      totalDue: 25_000,
      debtAsOf: null,
    })

    expect(text).not.toContain('01/01')
  })

  it('phiếu khách lẻ trả đủ không có dòng nợ nào', () => {
    const text = receiptToText({ shop: DEFAULT_SHOP, order: order(), lines, payments: [payment()], ...khongNo() })

    expect(text).not.toContain('NỢ CŨ')
    expect(text).not.toContain('TỔNG PHẢI TRẢ')
  })

  it('phiếu đơn ĐÃ HUỶ không in dòng nợ nào, dù sổ còn ghi paidAmount 0', () => {
    // RT-8, và chính cổng `totalDue !== remaining` đã gỡ chốt an toàn của nó: `voidOrder` đặt
    // `paidAmount = 0` (orders.ts:279) nên đơn huỷ nào cũng có `remainingOf = total > 0`, trong khi
    // `owingOf` của nó bằng 0. Cổng mở toang và in "Còn nợ 55.000" cạnh "TỔNG PHẢI TRẢ 0 đ" — ba con
    // số chửi nhau trên tờ giấy đưa khách. Nút XEM PHIẾU hiện cho cả đơn huỷ nên đây là đường thật.
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 0, status: 'void', customerId: 1, customerName: 'Anh Hùng', total: 55_000, subtotal: 55_000 }),
      lines,
      payments: [],
      // Khách này còn nợ THẬT 100.000 từ đơn khác — nợ không biến mất vì một đơn bị huỷ.
      priorDebt: 100_000,
      totalDue: 100_000,
      debtAsOf: new Date(2026, 7, 7, 14, 32).getTime(),
    })

    expect(text).not.toContain('CÒN NỢ')
    expect(text).not.toContain('NỢ CŨ')
    expect(text).not.toContain('TỔNG PHẢI TRẢ')
  })

  it('phiếu khách lẻ không bao giờ có khối nợ, kể cả khi sổ có dữ liệu hỏng', () => {
    // Nợ là tiền của một NGƯỜI cụ thể — `groupDebts` loại hẳn đơn không gắn khách. Khách lẻ mà còn
    // nợ là lỗi dữ liệu, và phiếu không được biến lỗi đó thành một con số đòi tiền.
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 0, status: 'unpaid', customerId: null, total: 55_000, subtotal: 55_000 }),
      lines,
      payments: [],
      priorDebt: 0,
      totalDue: 0,
      debtAsOf: null,
    })

    expect(text).not.toContain('TỔNG PHẢI TRẢ')
  })
})

