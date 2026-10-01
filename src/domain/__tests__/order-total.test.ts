import { describe, expect, it } from 'vitest'
import { calcLineAmount, calcOrderTotals, calcToppingTotal, calcUnitPriceWithToppings } from '../order-total'

describe('calcLineAmount', () => {
  it('nhân đơn giá với số lượng', () => {
    expect(calcLineAmount({ unitPrice: 55_000, qty: 2, toppings: [] })).toBe(110_000)
  })

  it('làm tròn ngay tại dòng khi số lượng thập phân', () => {
    expect(calcLineAmount({ unitPrice: 35_000, qty: 0.5, toppings: [] })).toBe(17_500)
    expect(calcLineAmount({ unitPrice: 33_333, qty: 0.3, toppings: [] })).toBe(10_000)
  })

  it('từ chối số lượng không dương và đơn giá không nguyên', () => {
    expect(() => calcLineAmount({ unitPrice: 1_000, qty: 0, toppings: [] })).toThrow(/lớn hơn 0/)
    expect(() => calcLineAmount({ unitPrice: 1_000.5, qty: 1, toppings: [] })).toThrow(/số nguyên/)
  })
})

describe('calcLineAmount với topping', () => {
  const tranChau = { unitPrice: 5_000, qty: 2 }
  const thach = { unitPrice: 3_000, qty: 1 }

  it('giá ly cộng topping rồi nhân số ly: (20.000 + 2×5.000 + 3.000) × 2', () => {
    expect(calcToppingTotal([tranChau, thach])).toBe(13_000)
    expect(calcUnitPriceWithToppings({ unitPrice: 20_000, toppings: [tranChau, thach] })).toBe(33_000)
    expect(calcLineAmount({ unitPrice: 20_000, qty: 2, toppings: [tranChau, thach] })).toBe(66_000)
  })

  it('không topping thì y như trước', () => {
    expect(calcLineAmount({ unitPrice: 20_000, qty: 2, toppings: [] })).toBe(40_000)
  })

  it('topping giá 0 (miễn phí) không đổi tiền', () => {
    expect(calcLineAmount({ unitPrice: 20_000, qty: 1, toppings: [{ unitPrice: 0, qty: 3 }] })).toBe(20_000)
  })

  it('làm tròn ở dòng sau khi đã cộng topping: (12.501 + 5.000) × 0,5 = 8.750,5 → 8.751', () => {
    expect(calcLineAmount({ unitPrice: 12_501, qty: 0.5, toppings: [{ unitPrice: 5_000, qty: 1 }] })).toBe(8_751)
  })

  it('từ chối topping có số phần không nguyên dương hoặc giá âm/lẻ', () => {
    expect(() => calcToppingTotal([{ unitPrice: 5_000, qty: 0 }])).toThrow(/số nguyên từ 1/)
    expect(() => calcToppingTotal([{ unitPrice: 5_000, qty: 1.5 }])).toThrow(/số nguyên từ 1/)
    expect(() => calcToppingTotal([{ unitPrice: -1, qty: 1 }])).toThrow(/không được âm/)
    expect(() => calcToppingTotal([{ unitPrice: 5_000.5, qty: 1 }])).toThrow(/số nguyên/)
  })
})

describe('calcOrderTotals', () => {
  const lines = [{ amount: 110_000 }, { amount: 6_000 }]

  it('cộng dồn rồi trừ giảm giá, cộng phụ thu', () => {
    expect(calcOrderTotals({ lines, discount: 6_000, surcharge: 10_000 })).toEqual({
      subtotal: 116_000,
      discount: 6_000,
      surcharge: 10_000,
      total: 120_000,
    })
  })

  it('kẹp giảm giá ở mức tiền hàng, tổng không bao giờ âm', () => {
    const totals = calcOrderTotals({ lines, discount: 500_000, surcharge: 0 })
    expect(totals.discount).toBe(116_000)
    expect(totals.total).toBe(0)
  })

  it('đơn rỗng cho tổng 0', () => {
    expect(calcOrderTotals({ lines: [], discount: 0, surcharge: 0 }).total).toBe(0)
  })

  it('KHÔNG làm tròn lại ở tổng — tổng luôn bằng đúng tổng các dòng đã làm tròn', () => {
    const half = calcLineAmount({ unitPrice: 12_501, qty: 0.5, toppings: [] }) // round(6250,5) = 6251
    expect(half).toBe(6_251)

    // 3 × 6.251 = 18.753. Nếu làm tròn ở tổng thì ra round(18.751,5) = 18.752 — lệch 1 đồng.
    const decimalLines = [{ amount: half }, { amount: half }, { amount: half }]
    expect(calcOrderTotals({ lines: decimalLines, discount: 0, surcharge: 0 }).total).toBe(18_753)
  })

  it('từ chối tiền không nguyên ở mọi cửa ngõ', () => {
    expect(() => calcOrderTotals({ lines: [{ amount: 1.5 }], discount: 0, surcharge: 0 })).toThrow()
    expect(() => calcOrderTotals({ lines, discount: -1, surcharge: 0 })).toThrow(/không được âm/)
  })
})
