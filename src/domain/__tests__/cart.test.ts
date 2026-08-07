import { describe, expect, it } from 'vitest'
import { cartCount, cartReducer, cartTotals, emptyCart, type Cart } from '../cart'
import { calcChange, suggestCashAmounts } from '../cash-suggestion'
import type { Item } from '../schema'

const item = (over: Partial<Item> = {}): Item => ({
  id: 1,
  name: 'Phở bò',
  groupId: null,
  unit: 'tô',
  unitPrice: 55_000,
  costPrice: 30_000,
  isActive: 1,
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const run = (actions: Parameters<typeof cartReducer>[1][], from: Cart = emptyCart()) =>
  actions.reduce(cartReducer, from)

describe('giỏ hàng', () => {
  it('chạm cùng một mặt hàng nhiều lần thì cộng dồn số lượng, không đẻ dòng mới', () => {
    const cart = run([
      { type: 'addItem', item: item() },
      { type: 'addItem', item: item() },
      { type: 'addItem', item: item(), qty: 3 },
    ])

    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]?.qty).toBe(5)
    expect(cartCount(cart)).toBe(5)
  })

  it('sửa giá một dòng rồi chạm lại mặt hàng đó → ra dòng mới, không đè giá đã sửa', () => {
    const added = run([{ type: 'addItem', item: item() }])
    const key = added.lines[0]?.key ?? ''

    const cart = run(
      [
        { type: 'setUnitPrice', key, unitPrice: 40_000 },
        { type: 'addItem', item: item() },
      ],
      added,
    )

    expect(cart.lines).toHaveLength(2)
    expect(cart.lines.map((line) => line.unitPrice)).toEqual([40_000, 55_000])
  })

  it('giảm số lượng về 0 là xoá dòng', () => {
    const added = run([{ type: 'addItem', item: item() }])
    const key = added.lines[0]?.key ?? ''

    expect(run([{ type: 'bumpQty', key, delta: -1 }], added).lines).toEqual([])
  })

  it('tính tổng qua domain: làm tròn từng dòng rồi mới trừ giảm giá', () => {
    const cart = run([
      { type: 'addItem', item: item({ id: 1, unitPrice: 12_501 }), qty: 0.5 },
      { type: 'addItem', item: item({ id: 2, name: 'Trà đá', unitPrice: 3_000 }), qty: 2 },
      { type: 'setDiscount', discount: 251 },
      { type: 'setSurcharge', surcharge: 5_000 },
    ])

    // 12.501 × 0,5 = 6.250,5 → 6.251 (làm tròn tại dòng)
    expect(cartTotals(cart)).toEqual({ subtotal: 12_251, discount: 251, surcharge: 5_000, total: 17_000 })
  })

  it('giảm giá lớn hơn tiền hàng bị kẹp lại, tổng không âm', () => {
    const cart = run([
      { type: 'addItem', item: item({ unitPrice: 10_000 }) },
      { type: 'setDiscount', discount: 99_000 },
    ])

    expect(cartTotals(cart)).toMatchObject({ discount: 10_000, total: 0 })
  })

  it('xoá giỏ trả về giỏ rỗng, không giữ lại khách đã chọn', () => {
    const cart = run([
      { type: 'setCustomer', customerId: 7, customerName: 'Anh Hùng' },
      { type: 'addItem', item: item() },
      { type: 'clear' },
    ])

    expect(cart).toEqual(emptyCart())
  })
})

describe('gợi ý tiền khách đưa', () => {
  it('gợi ý theo mệnh giá, luôn lớn hơn tổng', () => {
    expect(suggestCashAmounts(73_000)).toEqual([80_000, 100_000, 200_000])
    expect(suggestCashAmounts(145_000)).toEqual([150_000, 200_000, 500_000])
    expect(suggestCashAmounts(5_000)).toEqual([10_000, 50_000, 100_000])
  })

  it('tổng đã chẵn mệnh giá thì không gợi ý lại chính nó', () => {
    expect(suggestCashAmounts(100_000)).toEqual([200_000, 500_000])
  })

  it('giỏ rỗng thì không gợi ý gì', () => {
    expect(suggestCashAmounts(0)).toEqual([])
  })

  it('khách đưa thiếu thì tiền thối bằng 0, không ra số âm', () => {
    expect(calcChange(73_000, 100_000)).toBe(27_000)
    expect(calcChange(73_000, 50_000)).toBe(0)
  })
})
