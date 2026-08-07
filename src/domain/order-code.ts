import { format } from 'date-fns'

const CODE_PREFIX = 'PBH'
const CODE_PATTERN = /^PBH-(\d{6})-(\d{3,})$/

/** Phần ngày của số phiếu, theo giờ máy — đơn bán lúc 23h50 phải thuộc ngày hôm đó, không phải hôm sau UTC. */
export function orderCodeDatePart(soldAt: number): string {
  return format(soldAt, 'yyMMdd')
}

/** PBH-260807-001 */
export function buildOrderCode(soldAt: number, seqOfDay: number): string {
  if (!Number.isSafeInteger(seqOfDay) || seqOfDay < 1) {
    throw new Error(`Số thứ tự phiếu phải là số nguyên ≥ 1, nhận: ${seqOfDay}`)
  }
  return `${CODE_PREFIX}-${orderCodeDatePart(soldAt)}-${String(seqOfDay).padStart(3, '0')}`
}

export function parseOrderCode(code: string): { datePart: string; seq: number } | null {
  const matched = CODE_PATTERN.exec(code)
  if (!matched) return null
  return { datePart: matched[1] ?? '', seq: Number(matched[2]) }
}

/** Repository truyền vào mọi mã đã có; hàm thuần chọn số kế tiếp cho ngày của `soldAt`. */
export function nextSeqOfDay(existingCodes: readonly string[], soldAt: number): number {
  const datePart = orderCodeDatePart(soldAt)
  let max = 0
  for (const code of existingCodes) {
    const parsed = parseOrderCode(code)
    if (parsed?.datePart === datePart && parsed.seq > max) max = parsed.seq
  }
  return max + 1
}
