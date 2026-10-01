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

/**
 * Thứ tự tem ra giấy. Mỗi dòng có `copies` ly, mỗi ly có `pages` tem (ghi chú dài ra tem tiếp); các tem
 * của một ly đi liền nhau rồi mới sang ly kế. Số thứ tự `i/n` đếm theo ly qua cả đơn, nên các tem của
 * một ly mang chung số — người pha đếm ly chứ không đếm tờ giấy.
 */
export function labelSequence(
  items: readonly { pages: number; copies: number }[],
): { item: number; page: number; counter: string }[] {
  const total = items.reduce((sum, { copies }) => sum + Math.max(copies, 0), 0)
  const out: { item: number; page: number; counter: string }[] = []
  let cup = 0
  items.forEach(({ pages, copies }, item) => {
    for (let c = 0; c < copies; c++) {
      cup++
      for (let page = 0; page < pages; page++) out.push({ item, page, counter: `${cup}/${total}` })
    }
  })
  return out
}
