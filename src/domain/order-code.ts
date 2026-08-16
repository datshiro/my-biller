import { format } from 'date-fns'

const CODE_PREFIX = 'PBH'
const CODE_PATTERN = /^PBH-(\d{6})-([A-Z]?)(\d{3,})$/

/** Phần ngày của số phiếu, theo giờ máy — đơn bán lúc 23h50 phải thuộc ngày hôm đó, không phải hôm sau UTC. */
export function orderCodeDatePart(soldAt: number): string {
  return format(soldAt, 'yyMMdd')
}

/** PBH-260807-A001 */
export function buildOrderCode(soldAt: number, seqOfDay: number, deviceLetter: string): string {
  if (!Number.isSafeInteger(seqOfDay) || seqOfDay < 1) {
    throw new Error(`Số thứ tự phiếu phải là số nguyên ≥ 1, nhận: ${seqOfDay}`)
  }
  const letter = deviceLetter.trim().toUpperCase()
  if (!/^[A-Z]$/.test(letter)) throw new Error('Chữ cái máy phải là một ký tự từ A đến Z.')
  return `${CODE_PREFIX}-${orderCodeDatePart(soldAt)}-${letter}${String(seqOfDay).padStart(3, '0')}`
}

export function parseOrderCode(code: string): { datePart: string; letter: string | null; seq: number } | null {
  const matched = CODE_PATTERN.exec(code)
  if (!matched) return null
  return { datePart: matched[1] ?? '', letter: matched[2] || null, seq: Number(matched[3]) }
}

/** Repository truyền vào mọi mã đã có; hàm thuần chọn số kế tiếp cho ngày của `soldAt`. */
export function nextSeqOfDay(
  existingCodes: readonly string[],
  soldAt: number,
  deviceLetter: string,
): number {
  const datePart = orderCodeDatePart(soldAt)
  const letter = deviceLetter.trim().toUpperCase()
  let max = 0
  for (const code of existingCodes) {
    const parsed = parseOrderCode(code)
    if (parsed?.datePart === datePart && parsed.letter === letter && parsed.seq > max) max = parsed.seq
  }
  return max + 1
}
