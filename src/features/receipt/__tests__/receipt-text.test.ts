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
  { id: 1, gid: testGid(1), orderId: 1, itemId: 1, name: 'Phở bò', unit: 'tô', unitPrice: 55_000, costPrice: null, qty: 2, amount: 110_000 },
  { id: 2, gid: testGid(2), orderId: 1, itemId: 2, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: null, qty: 1, amount: 3_000 },
]

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
    const text = receiptToText({ shop: DEFAULT_SHOP, order: order(), lines, payments: [payment()] })

    expect(text).toContain('Số: PBH-260807-001')
    expect(text).toContain('07/08/2026 14:32')
    expect(text).toContain('Phở bò — 2 × 55.000 = 110.000')
    expect(text).toContain('Trà đá — 1 × 3.000 = 3.000')
    expect(text).toContain('TỔNG CỘNG: 113.000 đ')
    expect(text).toContain('Đã trả (tiền mặt): 113.000 đ')
  })

  it('chưa đặt tên quán → không có dòng trống ở đầu', () => {
    const text = receiptToText({ shop: DEFAULT_SHOP, order: order(), lines, payments: [] })

    expect(text.startsWith('PHIẾU BÁN HÀNG')).toBe(true)
  })

  it('đã đặt tên quán → tên, địa chỉ, số điện thoại lên đầu', () => {
    const text = receiptToText({
      shop: { ...DEFAULT_SHOP, name: 'Quán Cô Ba', address: '12 Nguyễn Trãi', phone: '0909 123 456' },
      order: order(),
      lines,
      payments: [],
    })

    expect(text.startsWith('Quán Cô Ba\n12 Nguyễn Trãi\n0909 123 456')).toBe(true)
  })

  it('còn nợ thì nói rõ còn nợ bao nhiêu', () => {
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ paidAmount: 40_000, status: 'partial', customerName: 'Chị Hoa' }),
      lines,
      payments: [payment({ amount: 40_000 })],
    })

    expect(text).toContain('CÒN NỢ: 73.000 đ')
  })

  it('có giảm giá / phụ thu thì tách rõ từng khoản, không gộp vào một số', () => {
    const text = receiptToText({
      shop: DEFAULT_SHOP,
      order: order({ discount: 13_000, surcharge: 5_000, total: 105_000, paidAmount: 105_000 }),
      lines,
      payments: [payment({ amount: 105_000 })],
    })

    expect(text).toContain('Hàng: 113.000 đ')
    expect(text).toContain('Giảm giá: 13.000 đ')
    expect(text).toContain('Phụ thu: 5.000 đ')
    expect(text).toContain('TỔNG CỘNG: 105.000 đ')
  })
})
