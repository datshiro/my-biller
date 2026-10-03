import type { CSSProperties } from 'react'
import { toppingLabel } from '@/domain/line-extras'
import type { LabelBlock } from '@/domain/label-pages'
import type { OrderLine } from '@/domain/schema'
import { COUNTER_HEIGHT, DOTS_PER_MM, labelDots, type LabelSize } from '@/domain/tspl/encode'
import type { Rect } from '@/domain/watermark'

export const labelUnit = (size: LabelSize) => labelDots(size).height / 10

/** Lề các cạnh của tem. */
export const labelPadding = (size: LabelSize) => labelUnit(size) * 0.4

/**
 * Lề trái thêm 2 mm: đầu in và cuộn tem lệch nhau vài phần mm nên chữ sát mép trái bị sát cạnh giấy. Chỉ cạnh
 * trái cần — số thứ tự bên phải do máy in vẽ cách mép phải 8 chấm và đã in ổn.
 */
export const labelPaddingLeft = (size: LabelSize) => labelPadding(size) + 2 * DOTS_PER_MM

/** Cạnh logo nhỏ ở góc trên phải: vừa hai dòng đầu tem (tên quán + mã đơn), ~5,75 mm ở tem 50×30. */
export const cornerLogoSide = (size: LabelSize) => Math.round(labelUnit(size) * 1.9)

/**
 * Chỗ đặt logo theo chấm in. Giữa tem: 90% chiều cao vùng chữ, căn giữa, không xuống hàng số thứ tự ở đáy. Góc trên
 * phải: ô vuông sát lề phải, ngang hàng tên quán — hai dòng đầu tem chừa chỗ cho nó (`LabelView`).
 */
export function watermarkBox(size: LabelSize, position: 'center' | 'corner'): Rect {
  const { width, height } = labelDots(size)
  const padding = labelPadding(size)
  if (position === 'corner') {
    const side = cornerLogoSide(size)
    return { x: Math.round(width - padding - side), y: Math.round(padding), width: side, height: side }
  }
  const left = labelPaddingLeft(size)
  const contentWidth = width - left - padding
  const contentHeight = height - 2 * padding - COUNTER_HEIGHT
  return {
    x: Math.round(left),
    y: Math.round(padding + contentHeight * 0.05),
    width: Math.round(contentWidth),
    height: Math.round(contentHeight * 0.9),
  }
}

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
