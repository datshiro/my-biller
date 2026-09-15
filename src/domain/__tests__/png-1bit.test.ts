import { crc32 as zlibCrc32, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DOTS_PER_LINE, bytesPerRow } from '../escpos/bitmap.ts'
import type { Bitmap } from '../escpos/bitmap.ts'
import { crc32, encodePng1 } from '../escpos/png-1bit.ts'
import { SAMPLE_HEIGHT, sampleBitmap } from '../escpos/sample.ts'

const STRIDE = bytesPerRow(DOTS_PER_LINE)

interface Chunk {
  type: string
  data: Uint8Array
  crc: number
}

function chunksOf(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Chunk[] = []
  let p = 8
  while (p < png.length) {
    const length = view.getUint32(p)
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8))
    chunks.push({ type, data: png.subarray(p + 8, p + 8 + length), crc: view.getUint32(p + 8 + length) })
    p += 12 + length
  }
  return chunks
}

function blank(height: number): Bitmap {
  return { width: DOTS_PER_LINE, height, data: new Uint8Array(STRIDE * height) }
}

describe('crc32', () => {
  it('khớp zlib.crc32 và giá trị chuẩn của IEND', () => {
    const iend = new TextEncoder().encode('IEND')
    expect(crc32(iend)).toBe(0xae426082)
    expect(crc32(iend)).toBe(zlibCrc32(iend))
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 0xff)
    expect(crc32(bytes)).toBe(zlibCrc32(bytes))
  })
})

describe('encodePng1', () => {
  it('chữ ký 8 byte và đúng ba chunk IHDR · IDAT · IEND', async () => {
    const png = await encodePng1(sampleBitmap())
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(chunksOf(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('IHDR: width/height big-endian, depth 1, color 0, còn lại 0', async () => {
    const [ihdr] = chunksOf(await encodePng1(sampleBitmap()))
    const view = new DataView(ihdr!.data.buffer, ihdr!.data.byteOffset, 13)
    expect(view.getUint32(0)).toBe(DOTS_PER_LINE)
    expect(view.getUint32(4)).toBe(SAMPLE_HEIGHT)
    expect(Array.from(ihdr!.data.subarray(8))).toEqual([1, 0, 0, 0, 0])
  })

  it('CRC mỗi chunk = zlib.crc32(type + data)', async () => {
    for (const chunk of chunksOf(await encodePng1(sampleBitmap()))) {
      const typed = new Uint8Array(4 + chunk.data.length)
      typed.set(new TextEncoder().encode(chunk.type))
      typed.set(chunk.data, 4)
      expect(chunk.crc).toBe(zlibCrc32(typed))
    }
  })

  it('IDAT giải nén = byte filter 0 + hàng đảo bit', async () => {
    const sample = sampleBitmap()
    const idat = chunksOf(await encodePng1(sample)).find((c) => c.type === 'IDAT')!
    const raw = inflateSync(idat.data)
    expect(raw.length).toBe((1 + STRIDE) * SAMPLE_HEIGHT)
    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      expect(raw[y * (1 + STRIDE)]).toBe(0)
      for (let i = 0; i < STRIDE; i++) {
        expect(raw[y * (1 + STRIDE) + 1 + i]).toBe(~sample.data[y * STRIDE + i]! & 0xff)
      }
    }
    const rowAt = (y: number) => Array.from(raw.subarray(y * (1 + STRIDE) + 1, (y + 1) * (1 + STRIDE)))
    expect(rowAt(45)).toEqual(Array(STRIDE).fill(0xff))
    expect(rowAt(60)).toEqual(Array(STRIDE).fill(0x00))
  })

  it('576×2 trắng → hai hàng toàn 0xFF', async () => {
    const idat = chunksOf(await encodePng1(blank(2))).find((c) => c.type === 'IDAT')!
    expect(Array.from(inflateSync(idat.data))).toEqual([0, ...Array(STRIDE).fill(0xff), 0, ...Array(STRIDE).fill(0xff)])
  })

  it('ném với bitmap 0 hàng — PNG cấm kích cỡ 0, macOS từ chối mở', async () => {
    await expect(encodePng1(blank(0))).rejects.toThrow('kích cỡ 0')
  })

  it('12×1: bit đệm cuối hàng thành trắng', async () => {
    const idat = chunksOf(await encodePng1({ width: 12, height: 1, data: Uint8Array.of(0b1000_0000, 0b0001_0000) })).find(
      (c) => c.type === 'IDAT',
    )!
    expect(Array.from(inflateSync(idat.data))).toEqual([0, 0b0111_1111, 0b1110_1111])
  })
})
