import type { CSSProperties } from 'react'
import type { LabelBlock } from '@/domain/label-pages'
import type { OrderLine } from '@/domain/schema'
import { labelDots, type LabelSize } from '@/domain/tspl/encode'

export const labelUnit = (size: LabelSize) => labelDots(size).height / 10

/** Dùng chung giữa tem thật và thước đo chia trang, để chữ đo ra đúng là chữ được vẽ. */
export function labelBodyStyle(size: LabelSize): CSSProperties {
  return { fontSize: `${labelUnit(size) * 0.7}px`, overflowWrap: 'anywhere' }
}

export function lineBlocks(line: OrderLine): LabelBlock[] {
  return line.note ? [{ kind: 'note', text: line.note }] : []
}
