import { describe, expect, it } from 'vitest'
import { bytesPerRow, type Bitmap } from '../escpos/bitmap'
import {
  bitmapToRgba,
  compositeUnder,
  cropBitmap,
  dilate,
  fitCoverage,
  getBit,
  inkBounds,
  renderLogoLayer,
} from '../watermark'

function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(bytesPerRow(width) * height) }
}

function withInk(width: number, height: number, ink: (x: number, y: number) => boolean): Bitmap {
  const b = blank(width, height)
  const stride = bytesPerRow(width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink(x, y)) b.data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7)
    }
  }
  return b
}

const solid = (width: number, height: number) => withInk(width, height, () => true)

function countInk(b: Bitmap): number {
  let n = 0
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (getBit(b, x, y)) n++
  return n
}

describe('inkBounds / cropBitmap', () => {
  const b = withInk(20, 10, (x, y) => (x === 3 && y === 2) || (x === 12 && y === 7))

  it('trả hộp sát vùng mực, null khi trắng trơn', () => {
    expect(inkBounds(b)).toEqual({ x: 3, y: 2, width: 10, height: 6 })
    expect(inkBounds(blank(8, 8))).toBeNull()
  })

  it('cắt đúng hộp', () => {
    const cropped = cropBitmap(b, { x: 3, y: 2, width: 10, height: 6 })
    expect([cropped.width, cropped.height]).toEqual([10, 6])
    expect(getBit(cropped, 0, 0)).toBe(true)
    expect(getBit(cropped, 9, 5)).toBe(true)
    expect(countInk(cropped)).toBe(2)
  })
})

describe('fitCoverage', () => {
  it('giữ tỉ lệ khi co vào hộp', () => {
    const fit = fitCoverage(solid(400, 200), 100, 100)
    expect([fit.width, fit.height]).toEqual([100, 50])
    expect(fit.coverage.every((c) => c === 1)).toBe(true)
  })

  it('mỗi chấm đích là tỉ lệ mực của vùng nguồn', () => {
    const fit = fitCoverage(
      withInk(4, 1, (x) => x < 2),
      2,
      1,
    )
    expect(Array.from(fit.coverage)).toEqual([1, 0])
  })
})

describe('renderLogoLayer', () => {
  const full = { x: 0, y: 0, width: 16, height: 16 }

  it('ghim độ phủ Bayer 4×4: Nhạt 3/16, Vừa 5/16, Đậm 8/16, đặc 16/16', () => {
    const logo = solid(16, 16)
    expect(countInk(renderLogoLayer({ width: 16, height: 16 }, logo, full, { kind: 'dither', cells: 3 }))).toBe(48)
    expect(countInk(renderLogoLayer({ width: 16, height: 16 }, logo, full, { kind: 'dither', cells: 5 }))).toBe(80)
    expect(countInk(renderLogoLayer({ width: 16, height: 16 }, logo, full, { kind: 'dither', cells: 8 }))).toBe(128)
    expect(countInk(renderLogoLayer({ width: 16, height: 16 }, logo, full, { kind: 'solid' }))).toBe(256)
  })

  it('co logo vừa hộp rồi căn giữa trong hộp', () => {
    const layer = renderLogoLayer(
      { width: 100, height: 50 },
      solid(10, 10),
      { x: 0, y: 0, width: 100, height: 50 },
      { kind: 'solid' },
    )
    expect(countInk(layer)).toBe(50 * 50)
    expect(getBit(layer, 25, 0)).toBe(true)
    expect(getBit(layer, 74, 49)).toBe(true)
    expect(getBit(layer, 24, 10)).toBe(false)
    expect(getBit(layer, 75, 10)).toBe(false)
  })
})

describe('dilate / compositeUnder', () => {
  it('dilate nở đều 8 hướng', () => {
    const dot = withInk(9, 9, (x, y) => x === 4 && y === 4)
    expect(countInk(dilate(dot, 2))).toBe(25)
  })

  it('chữ giữ nguyên, logo chừa viền trắng quanh nét chữ', () => {
    const text = withInk(40, 20, (x) => x === 20)
    const result = compositeUnder(text, solid(40, 20), 2)
    for (let y = 0; y < 20; y++) {
      expect(getBit(result, 20, y)).toBe(true)
      for (const x of [18, 19, 21, 22]) expect(getBit(result, x, y)).toBe(false)
    }
    expect(getBit(result, 10, 5)).toBe(true)
    expect(getBit(result, 17, 5)).toBe(true)
  })

  it('bit đệm cuối hàng luôn 0', () => {
    const results = [
      renderLogoLayer({ width: 13, height: 4 }, solid(13, 4), { x: 0, y: 0, width: 13, height: 4 }, { kind: 'solid' }),
      dilate(solid(13, 4), 2),
      compositeUnder(blank(13, 4), solid(13, 4), 1),
    ]
    for (const b of results) {
      for (let y = 0; y < b.height; y++) expect(b.data[y * bytesPerRow(13) + 1]! & 0b00000111).toBe(0)
    }
  })
})

describe('bitmapToRgba', () => {
  it('chấm mực thành đen, chấm trắng thành trắng, mọi chấm đục hẳn', () => {
    const b = withInk(3, 2, (x, y) => x === y)
    expect(Array.from(bitmapToRgba(b))).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ])
  })

  it('bỏ bit đệm cuối hàng: ảnh rộng 13 chấm ra đúng 13×4 chấm', () => {
    expect(bitmapToRgba(solid(13, 4)).length).toBe(13 * 4 * 4)
  })
})
