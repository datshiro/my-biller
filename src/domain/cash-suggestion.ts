import { assertMoney } from './money'

/**
 * Thang làm tròn tiền khách đưa. Cố tình KHÔNG có mốc 20k: hoá đơn 145.000 làm tròn theo 20k
 * ra 160.000 — số chẳng ai đưa. Người ta đưa 150.000 hoặc 200.000.
 */
const ROUND_UP_STEPS = [10_000, 50_000, 100_000, 200_000, 500_000] as const

/**
 * Các mốc tiền khách có thể đưa, luôn lớn hơn tổng đơn: làm tròn lên theo từng mệnh giá rồi bỏ trùng.
 * Tổng 73.000 → 80.000 / 100.000 / 200.000.
 * Không kèm chính con số tổng — nút "đủ tiền" là việc của giao diện, ở đây chỉ lo tiền thừa.
 */
export function suggestCashAmounts(total: number, limit = 3): number[] {
  assertMoney(total, 'Tổng đơn')
  if (total === 0) return []

  const rounded = ROUND_UP_STEPS.map((step) => Math.ceil(total / step) * step).filter(
    (amount) => amount > total,
  )
  return [...new Set(rounded)].sort((a, b) => a - b).slice(0, limit)
}

/** Tiền thối. Khách đưa thiếu thì không có tiền thối (phần thiếu là nợ, không phải số âm). */
export function calcChange(total: number, given: number): number {
  assertMoney(total, 'Tổng đơn')
  assertMoney(given, 'Tiền khách đưa')
  return Math.max(0, given - total)
}
