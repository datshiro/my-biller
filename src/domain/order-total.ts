import { assertMoney } from './money'

export type LineAmountInput = {
  unitPrice: number
  qty: number
  /** Bắt buộc, không có mặc định: quên truyền là typecheck đỏ chứ không âm thầm bán thiếu tiền topping. */
  toppings: readonly { unitPrice: number; qty: number }[]
}
export type OrderTotals = {
  subtotal: number
  discount: number
  surcharge: number
  total: number
}

/** Tiền topping cộng thêm cho MỘT ly. */
export function calcToppingTotal(toppings: LineAmountInput['toppings']): number {
  return toppings.reduce((sum, topping) => {
    assertMoney(topping.unitPrice, 'Giá topping')
    if (!Number.isInteger(topping.qty) || topping.qty < 1) {
      throw new Error(`Số lượng topping phải là số nguyên từ 1, nhận: ${topping.qty}`)
    }
    return sum + topping.unitPrice * topping.qty
  }, 0)
}

/** Giá của một ly đã gồm topping — con số `SL × đơn giá` trên phiếu. */
export const calcUnitPriceWithToppings = ({ unitPrice, toppings }: Pick<LineAmountInput, 'unitPrice' | 'toppings'>) =>
  assertMoney(unitPrice, 'Đơn giá') + calcToppingTotal(toppings)

/**
 * `unitPrice` luôn là giá của ly (từ danh mục, giá riêng, giá sỉ hay người bán gõ); topping cộng thêm lên
 * trên, nhân theo ly. Làm tròn ở TỪNG DÒNG, không bao giờ làm tròn ở tổng — khoá bằng test.
 */
export function calcLineAmount({ unitPrice, qty, toppings }: LineAmountInput): number {
  if (!(qty > 0)) throw new Error(`Số lượng phải lớn hơn 0, nhận: ${qty}`)
  return Math.round(calcUnitPriceWithToppings({ unitPrice, toppings }) * qty)
}

export function calcOrderTotals(input: {
  lines: readonly { amount: number }[]
  discount: number
  surcharge: number
}): OrderTotals {
  const subtotal = input.lines.reduce((sum, line) => sum + assertMoney(line.amount, 'Thành tiền'), 0)
  const surcharge = assertMoney(input.surcharge, 'Phụ thu')

  // Giảm giá không được vượt tiền hàng; trả về giá trị đã kẹp để UI hiển thị đúng cái thực sự áp dụng.
  const discount = Math.min(assertMoney(input.discount, 'Giảm giá'), subtotal)

  return { subtotal, discount, surcharge, total: subtotal - discount + surcharge }
}
