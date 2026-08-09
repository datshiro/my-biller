import { beforeEach, describe, expect, it } from 'vitest'
import { loadCartDraft, saveCartDraft } from '../cart-draft-storage'
import { emptyCart, type Cart } from '@/domain/cart'

const KEY = 'my-biller:cart-draft'

/**
 * Chuỗi này là **bản sao nguyên văn** những gì build cũ (trước bảng giá riêng) ghi vào localStorage:
 * dòng không có `retailPrice`/`priceSource`, giỏ không có `priceMode`, khoá dòng chưa có `#catalog`.
 * Cố ý viết cứng chứ không `JSON.stringify(emptyCart())` — round-trip bằng schema mới thì hai đầu
 * cùng sai vẫn xanh, và ca này mất sạch ý nghĩa.
 */
const NHAP_BAN_CU = JSON.stringify({
  customerId: 3,
  customerName: 'Cô Bảy',
  lines: [
    { key: '1@55000', itemId: 1, name: 'Phở bò', unit: 'tô', unitPrice: 55000, costPrice: 30000, qty: 2, note: '' },
    { key: 'x:Trà đá@5000', itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 5000, costPrice: null, qty: 3, note: 'ít đá' },
  ],
  discount: 10000,
  surcharge: 0,
  note: 'giao 7h',
})

beforeEach(() => localStorage.clear())

describe('nháp do bản build cũ ghi', () => {
  it('vẫn nạp được, không bị xoá', () => {
    localStorage.setItem(KEY, NHAP_BAN_CU)

    expect(loadCartDraft()).not.toBeNull()
    // Mất nháp là mất đơn đang lên dở mà không một dòng thông báo — kiểm cả việc nháp còn nằm đó.
    expect(localStorage.getItem(KEY)).toBe(NHAP_BAN_CU)
  })

  it('dòng cũ nhận priceSource "manual" và retailPrice bằng chính đơn giá của nó', () => {
    localStorage.setItem(KEY, NHAP_BAN_CU)
    const cart = loadCartDraft()

    expect(cart?.lines).toEqual([
      expect.objectContaining({ name: 'Phở bò', unitPrice: 55_000, retailPrice: 55_000, priceSource: 'manual' }),
      expect.objectContaining({ name: 'Trà đá', unitPrice: 5_000, retailPrice: 5_000, priceSource: 'manual' }),
    ])
  })

  it('giỏ cũ mở ra ở chế độ Lẻ', () => {
    localStorage.setItem(KEY, NHAP_BAN_CU)

    expect(loadCartDraft()?.priceMode).toBe('retail')
  })

  it('giữ nguyên phần còn lại của nháp', () => {
    localStorage.setItem(KEY, NHAP_BAN_CU)
    const cart = loadCartDraft()

    expect(cart).toMatchObject({ customerId: 3, customerName: 'Cô Bảy', discount: 10_000, note: 'giao 7h' })
  })
})

describe('nháp do bản build này ghi', () => {
  const cart: Cart = {
    ...emptyCart(),
    priceMode: 'wholesale',
    lines: [
      {
        key: '1@45000#catalog',
        itemId: 1,
        name: 'Phở bò',
        unit: 'tô',
        unitPrice: 45_000,
        retailPrice: 55_000,
        priceSource: 'catalog',
        costPrice: 30_000,
        qty: 2,
        note: '',
      },
    ],
  }

  it('đi qua lưu rồi nạp mà không mất chế độ giá lẫn giá lẻ gốc', () => {
    saveCartDraft(cart)

    expect(loadCartDraft()).toEqual(cart)
  })
})

describe('nháp hỏng', () => {
  it('bị bỏ đi thay vì làm trắng màn', () => {
    localStorage.setItem(KEY, '{"customerId": "không phải số"}')

    expect(loadCartDraft()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
