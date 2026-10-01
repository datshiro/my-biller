import type { CSSProperties } from 'react'
import { toppingLabel } from '@/domain/line-extras'
import type { LabelBlock } from '@/domain/label-pages'
import type { OrderLine } from '@/domain/schema'
import { labelDots, type LabelSize } from '@/domain/tspl/encode'

export const labelUnit = (size: LabelSize) => labelDots(size).height / 10

/**
 * Ba hạng mục của thân tem, đúng thứ tự người pha đọc: tuỳ chọn, topping, ghi chú khách. Phân biệt bằng
 * kiểu chữ chứ không bằng nhãn "Ghi chú:" — tem 50×30 mm không có chỗ phí. Dùng chung giữa tem thật và
 * thước đo chia trang, để chữ đo ra đúng là chữ được vẽ.
 */
export function labelBodyStyle(size: LabelSize, kind: string): CSSProperties {
  return {
    fontSize: `${labelUnit(size) * 0.7}px`,
    overflowWrap: 'anywhere',
    ...(kind === 'toppings' ? { fontWeight: 700 } : null),
    ...(kind === 'note' ? { fontStyle: 'italic' } : null),
  }
}

export function lineBlocks(line: OrderLine): LabelBlock[] {
  const blocks: LabelBlock[] = []
  if (line.options.length > 0) blocks.push({ kind: 'options', text: line.options.join(', ') })
  if (line.toppings.length > 0) {
    blocks.push({ kind: 'toppings', text: `+ ${line.toppings.map(toppingLabel).join(', ')}` })
  }
  if (line.note) blocks.push({ kind: 'note', text: line.note })
  return blocks
}
