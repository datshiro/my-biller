/**
 * Số tem cho một đơn: mỗi phần một tem, không nhìn tên món. Số lượng lẻ (0,5 kg) vẫn là một phần
 * cầm tay nên làm tròn LÊN từng dòng — cộng rồi mới làm tròn thì hai dòng 0,5 chỉ ra một tem.
 */
export function labelCount(lines: readonly { qty: number }[]): number {
  return lines.reduce((sum, line) => (line.qty > 0 ? sum + Math.ceil(line.qty) : sum), 0)
}
