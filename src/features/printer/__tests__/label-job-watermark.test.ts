import { describe, expect, it } from 'vitest'
import { buildWatermarkLayer } from '../label-job'
import { bytesPerRow, type Bitmap } from '@/domain/escpos/bitmap'
import type { LabelWatermark } from '@/domain/schema'
import { counterBox, labelDots, type LabelSize } from '@/domain/tspl/encode'
import { getBit } from '@/domain/watermark'
import { watermarkBox } from '@/features/receipt/label-layout'

const logo: Bitmap = { width: 40, height: 40, data: new Uint8Array(bytesPerRow(40) * 40).fill(0xff) }
const on = (position: LabelWatermark['position']): LabelWatermark => ({ enabled: true, position, strength: 'medium' })

function inkIn(b: Bitmap, x0: number, y0: number, x1: number, y1: number): number {
  let ink = 0
  for (let y = Math.max(0, y0); y < Math.min(b.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(b.width, x1); x++) if (getBit(b, x, y)) ink++
  }
  return ink
}

/** Ô số thứ tự `i/n` máy in tự vẽ, nới 4 chấm về phía trên và trái — lớp logo phải để trống. */
function counterInk(b: Bitmap, size: LabelSize, total: number): number {
  const box = counterBox(size, total)
  return inkIn(b, box.x - 4, box.y - 4, b.width, b.height)
}

describe('lớp logo của một lệnh in tem', () => {
  const tem50x30: LabelSize = { widthMm: 50, heightMm: 30, gapMm: 2 }

  it('tắt hình chìm thì không có lớp nào — ảnh tem giữ nguyên như trước', () => {
    expect(buildWatermarkLayer(tem50x30, 3, { logo, config: { ...on('center'), enabled: false } })).toBeNull()
  })

  it('giữa tem 50×30: đúng khổ, có mực, ô số thứ tự sạch', () => {
    const layer = buildWatermarkLayer(tem50x30, 3, { logo, config: on('center') })
    expect(layer && [layer.width, layer.height]).toEqual([400, 240])
    expect(layer && inkIn(layer, 0, 0, 400, 240)).toBeGreaterThan(0)
    expect(layer && counterInk(layer, tem50x30, 3)).toBe(0)
  })

  it('góc trên phải ở tem nhỏ 30×25: logo đặc trong ô góc, ô số thứ tự sạch', () => {
    const size: LabelSize = { widthMm: 30, heightMm: 25, gapMm: 2 }
    const layer = buildWatermarkLayer(size, 12, { logo, config: on('corner') })
    const box = watermarkBox(size, 'corner')
    expect(layer && inkIn(layer, box.x, box.y, box.x + box.width, box.y + box.height)).toBe(box.width * box.height)
    expect(layer && counterInk(layer, size, 12)).toBe(0)
  })

  it('tem 72×100: lớp đúng khổ tem', () => {
    const size: LabelSize = { widthMm: 72, heightMm: 100, gapMm: 2 }
    const layer = buildWatermarkLayer(size, 1, { logo, config: on('center') })
    expect(layer && { width: layer.width, height: layer.height }).toEqual(labelDots(size))
  })
})
