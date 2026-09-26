/**
 * Số tem của từng dòng: mỗi phần một tem. Số lượng lẻ (0,5 kg) vẫn là một phần cầm tay nên làm tròn
 * LÊN từng dòng — cộng rồi mới làm tròn thì hai dòng 0,5 chỉ ra một tem.
 */
export function labelCopies(lines: readonly { qty: number }[]): number[] {
  return lines.map((line) => (line.qty > 0 ? Math.ceil(line.qty) : 0))
}

export function labelCount(lines: readonly { qty: number }[]): number {
  return labelCopies(lines).reduce((sum, n) => sum + n, 0)
}
