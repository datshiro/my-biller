const GROUPED = new Intl.NumberFormat('vi-VN')

/** Mọi số tiền trong app là số nguyên VND. Gọi ở cửa ngõ ghi DB để float không lọt xuống. */
export function assertInt(value: number, label = 'Số tiền'): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} phải là số nguyên đồng, nhận: ${value}`)
  }
  return value
}

export function assertMoney(value: number, label = 'Số tiền'): number {
  assertInt(value, label)
  if (value < 0) throw new Error(`${label} không được âm, nhận: ${value}`)
  return value
}

export function formatVnd(amount: number): string {
  return `${GROUPED.format(amount)} đ`
}

/** Số trần, không có " đ" — dùng cho ô nhập và cột số trong bảng. */
export function formatAmount(amount: number): string {
  return GROUPED.format(amount)
}

const PLAIN_DIGITS = /^\d+$/
// Dấu phân nhóm phải đủ 3 chữ số và dùng nhất quán một loại dấu: "1.250.000" đúng, "1.250,000" sai.
const GROUPED_DIGITS = /^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/

/**
 * Nhận "50000" | "50.000" | "50,000" | "50 000" | "50k" → 50000.
 * VND không có đơn vị nhỏ hơn đồng nên dấu chấm/phẩy luôn là dấu phân nhóm, không phải thập phân —
 * vì thế "50.5" bị từ chối chứ không âm thầm biến thành 505.
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s/g, '')
  const inThousands = cleaned.endsWith('k')
  const digits = inThousands ? cleaned.slice(0, -1) : cleaned

  if (!PLAIN_DIGITS.test(digits) && !GROUPED_DIGITS.test(digits)) return null

  const base = Number(digits.replace(/[.,]/g, ''))
  const value = inThousands ? base * 1000 : base
  return Number.isSafeInteger(value) ? value : null
}

const QTY_INPUT = /^(\d+)(?:[.,](\d{1,3}))?$/

/** Số lượng là giá trị duy nhất được phép thập phân (0,5 kg). Tối đa 3 chữ số sau dấu phẩy. */
export function parseQtyInput(raw: string): number | null {
  const matched = QTY_INPUT.exec(raw.trim().replace(/\s/g, ''))
  if (!matched) return null

  const value = Number(`${matched[1]}.${matched[2] ?? '0'}`)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(qty).replace('.', ',')
}
