import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOTS_PER_LINE, bytesPerRow, concatBitmaps } from '../escpos/bitmap.ts'
import type { Bitmap, RgbaImage } from '../escpos/bitmap.ts'
import { decodeJob } from '../escpos/decode.ts'
import { CUT_FEED, ROWS_PER_BAND, encodeJob } from '../escpos/encode.ts'
import { SAMPLE_HEIGHT, sampleBitmap } from '../escpos/sample.ts'
import { INK_THRESHOLD, toBitmap } from '../escpos/threshold.ts'

const STRIDE = bytesPerRow(DOTS_PER_LINE)

type Rgba = [number, number, number, number]

function rgba(width: number, height: number, pixel: (x: number, y: number) => Rgba): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return { width, height, data }
}

const BLACK: Rgba = [0, 0, 0, 255]
const WHITE: Rgba = [255, 255, 255, 255]

function fullWidth(height: number, fill = 0): Bitmap {
  return { width: DOTS_PER_LINE, height, data: new Uint8Array(STRIDE * height).fill(fill) }
}

function noise(height: number, seed: number): Bitmap {
  const data = new Uint8Array(STRIDE * height)
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + seed) & 0xff
  return { width: DOTS_PER_LINE, height, data }
}

function hexAt(bytes: Uint8Array, start: number, count: number): string {
  return Array.from(bytes.subarray(start, start + count), (b) => b.toString(16).padStart(2, '0')).join(' ')
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

describe('toBitmap', () => {
  it('8×1: chấm đen đầu hàng nằm ở bit cao nhất (MSB trước)', () => {
    const image = rgba(8, 1, (x) => (x === 0 ? BLACK : WHITE))
    expect(Array.from(toBitmap(image).data)).toEqual([0b1000_0000])
  })

  it('12×2: mỗi hàng 2 byte, bit đệm cuối hàng là 0', () => {
    const image = rgba(12, 2, (x, y) => ((y === 0 && (x === 0 || x === 11)) || (y === 1 && x === 8) ? BLACK : WHITE))
    expect(Array.from(toBitmap(image).data)).toEqual([0b1000_0000, 0b0001_0000, 0b0000_0000, 0b1000_0000])
  })

  it('chấm trong suốt là trắng dù màu đen', () => {
    const image = rgba(8, 1, () => [0, 0, 0, 0])
    expect(Array.from(toBitmap(image).data)).toEqual([0])
  })

  it(`ngưỡng ${INK_THRESHOLD}: xám ngay dưới là mực, bằng ngưỡng là trắng`, () => {
    const ink = INK_THRESHOLD - 1
    const image = rgba(8, 1, (x) => (x === 0 ? [ink, ink, ink, 255] : [INK_THRESHOLD, INK_THRESHOLD, INK_THRESHOLD, 255]))
    expect(Array.from(toBitmap(image).data)).toEqual([0b1000_0000])
  })

  it('ngưỡng tuỳ chọn: 200 biến xám 176 thành mực', () => {
    const image = rgba(8, 1, () => [INK_THRESHOLD, INK_THRESHOLD, INK_THRESHOLD, 255])
    expect(Array.from(toBitmap(image, 200).data)).toEqual([0xff])
  })

  it('ném khi mảng RGBA không khớp kích cỡ — ảnh cụt không được lặng lẽ thành trắng', () => {
    expect(() => toBitmap({ width: 8, height: 2, data: new Uint8ClampedArray(8 * 4) })).toThrow('cần 64 byte')
  })
})

describe('bất biến import của lớp thuần', () => {
  // Node import thẳng `.ts` (script máy in ảo, script gửi) chỉ chạy khi mọi import tương đối có đuôi `.ts`
  // và không kéo `node:*`. tsc/Vite/ESLint đều chấp nhận import không đuôi nên không cổng nào khác giữ.
  const domainDir = fileURLToPath(new URL('../', import.meta.url))
  const files = [
    ...readdirSync(join(domainDir, 'escpos')).map((name) => join('escpos', name)),
    'base64.ts',
  ]

  it.each(files)('%s: import tương đối có đuôi .ts, không import node:*', (file) => {
    const source = readFileSync(join(domainDir, file), 'utf8')
    const specifiers = Array.from(source.matchAll(/from\s+'([^']+)'/g), (m) => m[1]!)
    expect(specifiers.length).toBeGreaterThanOrEqual(0)
    for (const spec of specifiers) {
      expect(spec, `${file} import ${spec}`).not.toMatch(/^node:/)
      if (spec.startsWith('.')) expect(spec, `${file} import ${spec}`).toMatch(/\.ts$/)
    }
  })
})

describe('encodeJob', () => {
  it('golden: 576×2 trắng → ESC @, một khối 72×2, cắt', () => {
    const job = encodeJob(fullWidth(2))
    expect(job.length).toBe(2 + 8 + 2 * STRIDE + 4)
    expect(hexAt(job, 0, 2)).toBe('1b 40')
    expect(hexAt(job, 2, 8)).toBe(`1d 76 30 00 ${hex2(STRIDE)} 00 02 00`)
    expect(hexAt(job, 10, 2 * STRIDE)).toBe(Array(2 * STRIDE).fill('00').join(' '))
    expect(hexAt(job, job.length - 4, 4)).toBe(`1d 56 42 ${hex2(CUT_FEED)}`)
  })

  it.each([360, 540, 720])('ném khi bitmap rộng %i chấm', (width) => {
    expect(() => encodeJob({ width, height: 1, data: new Uint8Array(bytesPerRow(width)) })).toThrow('576')
  })

  it('ném khi số byte không khớp kích cỡ', () => {
    expect(() => encodeJob({ width: DOTS_PER_LINE, height: 2, data: new Uint8Array(STRIDE) })).toThrow(
      `cần ${2 * STRIDE} byte`,
    )
  })

  it('ném khi height không nguyên', () => {
    expect(() => encodeJob({ width: DOTS_PER_LINE, height: 2.5, data: new Uint8Array(STRIDE * 2.5) })).toThrow('số nguyên')
  })

  it.each([0, 1.5, 65_536])('ném khi rowsPerBand = %s', (rowsPerBand) => {
    expect(() => encodeJob(fullWidth(1), { rowsPerBand })).toThrow('rowsPerBand')
  })

  it.each([-1, 256, 2.5])('ném khi feed = %s', (feed) => {
    expect(() => encodeJob(fullWidth(1), { feed })).toThrow('feed')
  })

  it(`300 hàng → ${ROWS_PER_BAND} + ${ROWS_PER_BAND} + ${300 - 2 * ROWS_PER_BAND}, tổng dữ liệu 72 × 300`, () => {
    const job = encodeJob(fullWidth(300, 0xff))
    expect(job.length).toBe(2 + 3 * 8 + STRIDE * 300 + 4)
    const { commands, bitmap } = decodeJob(job)
    expect(commands).toEqual([
      'ESC @',
      `GS v 0 ${STRIDE}x${ROWS_PER_BAND}`,
      `GS v 0 ${STRIDE}x${ROWS_PER_BAND}`,
      `GS v 0 ${STRIDE}x${300 - 2 * ROWS_PER_BAND}`,
      `GS V 66 ${CUT_FEED}`,
    ])
    expect(bitmap.data.length).toBe(STRIDE * 300)
  })

  it('{ cut: false } không có GS V', () => {
    const job = encodeJob(fullWidth(1), { cut: false })
    expect(job.length).toBe(2 + 8 + STRIDE)
    expect(decodeJob(job).commands).toEqual(['ESC @', `GS v 0 ${STRIDE}x1`])
  })

  it('rowsPerBand 48 chia tờ mẫu 180 hàng thành 48 + 48 + 48 + 36', () => {
    const { commands } = decodeJob(encodeJob(sampleBitmap(), { rowsPerBand: 48 }))
    expect(commands.filter((c) => c.startsWith('GS v 0'))).toEqual([
      `GS v 0 ${STRIDE}x48`,
      `GS v 0 ${STRIDE}x48`,
      `GS v 0 ${STRIDE}x48`,
      `GS v 0 ${STRIDE}x36`,
    ])
  })

  it('feed tuỳ chọn đi vào GS V 66 n', () => {
    const job = encodeJob(fullWidth(1), { feed: 9 })
    expect(hexAt(job, job.length - 4, 4)).toBe('1d 56 42 09')
  })
})

describe('decodeJob', () => {
  it.each([2, 300])('round-trip %i hàng', (height) => {
    const bitmap = noise(height, 7)
    expect(decodeJob(encodeJob(bitmap)).bitmap).toEqual(bitmap)
  })

  it('ném byte lạ ở đầu', () => {
    expect(() => decodeJob(Uint8Array.of(0xff, 0x1b, 0x40))).toThrow('Byte lạ 0xFF tại vị trí 0')
  })

  it('ném GS v 0 với m ≠ 0', () => {
    const bytes = Uint8Array.of(0x1d, 0x76, 0x30, 0x01, STRIDE, 0x00, 0x01, 0x00, ...new Uint8Array(STRIDE))
    expect(() => decodeJob(bytes)).toThrow('m=1')
  })

  it('ném khối lệch khổ (384 chấm)', () => {
    const bytes = Uint8Array.of(0x1d, 0x76, 0x30, 0x00, 48, 0x00, 0x01, 0x00, ...new Uint8Array(48))
    expect(() => decodeJob(bytes)).toThrow('384')
  })

  it('ném khi thiếu dữ liệu khối', () => {
    const bytes = Uint8Array.of(0x1d, 0x76, 0x30, 0x00, STRIDE, 0x00, 0x02, 0x00, ...new Uint8Array(10))
    expect(() => decodeJob(bytes)).toThrow('Thiếu byte')
  })

  it('hiểu ESC d và GS V không có n', () => {
    const { commands, bitmap } = decodeJob(Uint8Array.of(0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00))
    expect(commands).toEqual(['ESC d 3', 'GS V 0'])
    expect(bitmap).toEqual({ width: DOTS_PER_LINE, height: 0, data: new Uint8Array(0) })
  })
})

describe('đường ống ảnh → bitmap → job → máy in ảo', () => {
  // Đúng chuỗi buildReceiptJob của pha 2 sẽ chạy: RgbaImage 576 rộng từ canvas → toBitmap → encodeJob → decodeJob
  it('ảnh 576×300 có cột đen x=0, đường chéo và nền trắng đi xuyên nguyên vẹn', () => {
    const image = rgba(DOTS_PER_LINE, 300, (x, y) => (x === 0 || x === y * 2 || x === DOTS_PER_LINE - 1 ? BLACK : WHITE))
    const bitmap = toBitmap(image)
    const { bitmap: decoded, commands } = decodeJob(encodeJob(bitmap))
    expect(decoded).toEqual(bitmap)
    expect(commands).toHaveLength(1 + Math.ceil(300 / ROWS_PER_BAND) + 1)
    const bit = (x: number, y: number) => ((decoded.data[y * STRIDE + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1
    expect(bit(0, 0)).toBe(1)
    expect(bit(DOTS_PER_LINE - 1, 299)).toBe(1)
    expect(bit(200, 100)).toBe(1)
    expect(bit(201, 100)).toBe(0)
    expect(bit(1, 0)).toBe(0)
  })
})

describe('sampleBitmap', () => {
  const sample = sampleBitmap()
  const row = (y: number) => Array.from(sample.data.subarray(y * STRIDE, (y + 1) * STRIDE))

  it(`576 × ${SAMPLE_HEIGHT}`, () => {
    expect(sample.width).toBe(DOTS_PER_LINE)
    expect(sample.height).toBe(SAMPLE_HEIGHT)
    expect(sample.data.length).toBe(STRIDE * SAMPLE_HEIGHT)
  })

  it('hàng 0: vạch nhỏ mỗi 8 chấm, chấm cuối cũng đen', () => {
    expect(row(0)).toEqual([...Array(STRIDE - 1).fill(0x80), 0x81])
  })

  it('hàng 30: chỉ vạch lớn ở x = 0, 64, …, 512 và 575', () => {
    const expected = Array(STRIDE).fill(0)
    for (let x = 0; x < DOTS_PER_LINE; x += 64) expected[x >> 3] = 0x80
    expected[STRIDE - 1] = 0x01
    expect(row(30)).toEqual(expected)
  })

  it('thanh 576: hàng 50–69 toàn đen, hàng 49 và 70 trắng', () => {
    for (const y of [50, 60, 69]) expect(row(y)).toEqual(Array(STRIDE).fill(0xff))
    expect(row(49)).toEqual(Array(STRIDE).fill(0))
    expect(row(70)).toEqual(Array(STRIDE).fill(0))
  })

  it('thanh 288: hàng 80 có đúng 36 byte đen ở nửa trái', () => {
    expect(row(80)).toEqual([...Array(36).fill(0xff), ...Array(36).fill(0)])
  })

  it('bàn cờ 8×8: hàng 110 và 118 đảo nhau', () => {
    expect(row(110).slice(0, 4)).toEqual([0xff, 0, 0xff, 0])
    expect(row(118).slice(0, 4)).toEqual([0, 0xff, 0, 0xff])
  })
})

describe('concatBitmaps', () => {
  it('nối dọc, byte top rồi bottom', () => {
    const top = noise(2, 1)
    const bottom = noise(3, 2)
    const joined = concatBitmaps(top, bottom)
    expect(joined.width).toBe(DOTS_PER_LINE)
    expect(joined.height).toBe(5)
    expect(Array.from(joined.data)).toEqual([...top.data, ...bottom.data])
  })

  it('ném khi hai bitmap khác chiều rộng', () => {
    const narrow: Bitmap = { width: 8, height: 1, data: new Uint8Array(1) }
    expect(() => concatBitmaps(fullWidth(1), narrow)).toThrow('576 và 8')
  })
})
