import { describe, expect, it } from 'vitest'
import { resolveUnitPrice, type PriceBook } from '../wholesale-price'

const line = (over: { itemId?: number | null; retailPrice?: number } = {}) => ({
  itemId: 1 as number | null,
  retailPrice: 55_000,
  ...over,
})

const book: PriceBook = new Map([[1, 45_000]])

describe('resolveUnitPrice', () => {
  it('đang SỈ và khách có giá riêng cho món này → lấy giá riêng', () => {
    expect(resolveUnitPrice(line(), 'wholesale', book)).toBe(45_000)
  })

  it('đang SỈ nhưng khách chưa đặt giá cho món này → rơi về giá lẻ', () => {
    expect(resolveUnitPrice(line({ itemId: 2 }), 'wholesale', book)).toBe(55_000)
  })

  it('bán lẻ thì bảng giá nằm im, dù khách có giá riêng', () => {
    expect(resolveUnitPrice(line(), 'retail', book)).toBe(55_000)
  })

  it('món ngoài danh mục không tra được bảng giá', () => {
    expect(resolveUnitPrice(line({ itemId: null }), 'wholesale', book)).toBe(55_000)
  })

  it('khách chưa có bảng giá nào → giá lẻ, không ném', () => {
    expect(resolveUnitPrice(line(), 'wholesale', new Map())).toBe(55_000)
  })

  /**
   * Ca này là lý do dùng `??` chứ không `||`. Với `||` thì giá riêng `0` bị coi là "chưa đặt" và món
   * người bán quyết định cho không sẽ bị tính đủ tiền — sai về phía thu thừa của khách.
   */
  it('giá riêng bằng 0 là giá thật, không phải "chưa đặt"', () => {
    expect(resolveUnitPrice(line(), 'wholesale', new Map([[1, 0]]))).toBe(0)
  })

  /** Bảng giá là quyền quyết định của người bán, không phải "chỉ được rẻ hơn". */
  it('giá riêng cao hơn giá lẻ vẫn được dùng', () => {
    expect(resolveUnitPrice(line(), 'wholesale', new Map([[1, 60_000]]))).toBe(60_000)
  })
})
