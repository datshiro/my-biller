import { describe, expect, it } from 'vitest'
import { normalizeName, parseOrderText, type ItemCandidate } from '../order-draft/parse-order-text'

const items: ItemCandidate[] = [
  { id: 1, name: 'Phở bò đặc biệt', unit: 'tô', unitPrice: 55_000, costPrice: 30_000 },
  { id: 2, name: 'Phở bò', unit: 'tô', unitPrice: 45_000, costPrice: 25_000 },
  { id: 3, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: 500 },
  { id: 4, name: 'Bia 333', unit: 'lon', unitPrice: 18_000, costPrice: 13_000 },
]

describe('normalizeName', () => {
  it('bỏ dấu và chuẩn hoá khoảng trắng', () => {
    expect(normalizeName('  Phở  Bò  ĐẶC biệt ')).toBe('pho bo dac biet')
    expect(normalizeName('Đường')).toBe('duong')
  })
})

describe('parseOrderText', () => {
  it('tách nhiều món, nhận số lượng đứng đầu', () => {
    expect(parseOrderText('2 pho bo dac biet, 3 tra da', items)).toEqual([
      { itemId: 1, name: 'Phở bò đặc biệt', unit: 'tô', unitPrice: 55_000, costPrice: 30_000, qty: 2 },
      { itemId: 3, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: 500, qty: 3 },
    ])
  })

  it('không ghi số lượng thì mặc định 1', () => {
    expect(parseOrderText('tra da', items)).toEqual([
      { itemId: 3, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: 500, qty: 1 },
    ])
  })

  it('gõ có dấu vẫn khớp', () => {
    expect(parseOrderText('2 Trà Đá', items).map((line) => line.itemId)).toEqual([3])
  })

  it('khớp chính xác được ưu tiên hơn khớp một phần', () => {
    // "pho bo" khớp cả 2 mặt hàng, nhưng trùng khít tên #2 nên phải chọn #2
    expect(parseOrderText('pho bo', items)[0]?.itemId).toBe(2)
  })

  it('khớp nhiều mà không trùng khít thì chọn tên ngắn nhất', () => {
    expect(parseOrderText('pho', items)[0]?.itemId).toBe(2)
  })

  it('nhận số lượng thập phân', () => {
    expect(parseOrderText('0,5 tra da', items)[0]?.qty).toBe(0.5)
  })

  it('tên mặt hàng có số vẫn đọc đúng', () => {
    expect(parseOrderText('2 bia 333', items)).toEqual([
      { itemId: 4, name: 'Bia 333', unit: 'lon', unitPrice: 18_000, costPrice: 13_000, qty: 2 },
    ])
    expect(parseOrderText('333', items)[0]?.itemId).toBe(4)
  })

  it('bỏ qua cụm không khớp, giữ lại cụm khớp', () => {
    expect(parseOrderText('2 xyz, 1 tra da', items).map((line) => line.itemId)).toEqual([3])
  })

  it('cụm chỉ còn rác sau khi bỏ dấu thì bỏ qua, không vơ bừa mặt hàng nào', () => {
    // Nhập bằng giọng nói có thể sinh ra dấu thanh lạc lõng; bỏ dấu xong còn chuỗi rỗng.
    expect(parseOrderText('2 ̀', items)).toEqual([])
  })

  it('không khớp gì thì trả mảng rỗng', () => {
    expect(parseOrderText('bánh mì thịt', items)).toEqual([])
    expect(parseOrderText('', items)).toEqual([])
  })

  it('tách được cả xuống dòng và dấu cộng', () => {
    expect(parseOrderText('2 tra da\n1 bia 333 + 1 pho bo', items)).toHaveLength(3)
  })

  it('gõ "0 pho" ở ô tìm món thì không thêm dòng nào', () => {
    // Trước bản này `parseQtyInput('0')` trả `null` nên nhánh `qty === null` chặn hộ. Giờ `0` là số
    // đọc được, chỗ này phải tự chặn: để lọt là một dòng 0 ly nằm trong giỏ, và `calcLineAmount` ném
    // khi chốt đơn — ném trong thân render, tức màn trắng giữa lúc bán.
    expect(parseOrderText('0 pho bo', items)).toEqual([])
  })

  it('"1.000 pho" không âm thầm thành 1 tô', () => {
    // Chủ quán gõ kiểu tiền tệ: định nói một nghìn tô. Từ chối, không đoán.
    expect(parseOrderText('1.000 pho bo', items)).toEqual([])
  })
})

