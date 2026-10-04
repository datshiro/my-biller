// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bytesPerRow, type Bitmap } from '@/domain/escpos/bitmap'
import type { LabelWatermark } from '@/domain/schema'
import { labelDots, type LabelSize } from '@/domain/tspl/encode'
import { getBit } from '@/domain/watermark'

const canvasShim = vi.hoisted(() => ({ width: 400, height: 240, pixel: 255 }))
vi.mock('html-to-image', () => ({
  toCanvas: vi.fn(async () => ({
    width: canvasShim.width,
    height: canvasShim.height,
    getContext: () => ({
      getImageData: () => ({
        width: canvasShim.width,
        height: canvasShim.height,
        data: new Uint8ClampedArray(canvasShim.width * canvasShim.height * 4).fill(canvasShim.pixel),
      }),
    }),
  })),
}))

import { renderLabelPreview } from '../label-job'

const size: LabelSize = { widthMm: 50, heightMm: 30, gapMm: 2 }
const logo: Bitmap = { width: 40, height: 40, data: new Uint8Array(bytesPerRow(40) * 40).fill(0xff) }
const config = (patch: Partial<LabelWatermark>): LabelWatermark => ({
  enabled: true,
  position: 'center',
  strength: 'dark',
  align: 'center',
  ...patch,
})

function inkIn(b: Bitmap, x0: number, x1: number): number {
  let ink = 0
  for (let y = 0; y < b.height; y++) for (let x = x0; x < Math.min(b.width, x1); x++) if (getBit(b, x, y)) ink++
  return ink
}

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  Object.assign(canvasShim, { width: 400, height: 240, pixel: 255 })
})

describe('renderLabelPreview — cùng đường chụp và ghép với lệnh in tem', () => {
  const node = document.createElement('div')

  it('không logo: ra đúng ảnh chữ (ở đây trắng trơn), đúng khổ tem', async () => {
    const preview = await renderLabelPreview(node, size, null)
    expect({ width: preview.width, height: preview.height }).toEqual(labelDots(size))
    expect(inkIn(preview, 0, 400)).toBe(0)
  })

  it('logo giữa tem và bên phải cho hai ảnh khác nhau: bên phải không có mực ở nửa trái', async () => {
    const center = await renderLabelPreview(node, size, { logo, config: config({ align: 'center' }) })
    const right = await renderLabelPreview(node, size, { logo, config: config({ align: 'right' }) })
    expect(inkIn(center, 0, 200)).toBeGreaterThan(0)
    expect(inkIn(right, 0, 200)).toBe(0)
    expect(inkIn(right, 200, 400)).toBeGreaterThan(0)
  })

  it('mức đậm đổi độ phủ: Đậm nhiều mực hơn Nhạt', async () => {
    const light = await renderLabelPreview(node, size, { logo, config: config({ strength: 'light' }) })
    const dark = await renderLabelPreview(node, size, { logo, config: config({ strength: 'dark' }) })
    expect(inkIn(dark, 0, 400)).toBeGreaterThan(inkIn(light, 0, 400))
  })

  it('chụp lệch khổ tem thì ném lỗi, như khi in', async () => {
    canvasShim.width = 399
    await expect(renderLabelPreview(node, size, null)).rejects.toThrow(/399×240 chấm/)
  })
})
