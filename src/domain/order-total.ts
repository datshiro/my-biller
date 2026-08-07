import { assertMoney } from './money'

export type LineAmountInput = { unitPrice: number; qty: number }
export type OrderTotals = {
  subtotal: number
  discount: number
  surcharge: number
  total: number
}

/** Làm tròn ở TỪNG DÒNG, không bao giờ làm tròn ở tổng — khoá bằng test. */
export function calcLineAmount({ unitPrice, qty }: LineAmountInput): number {
  assertMoney(unitPrice, 'Đơn giá')
  if (!(qty > 0)) throw new Error(`Số lượng phải lớn hơn 0, nhận: ${qty}`)
  return Math.round(unitPrice * qty)
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
