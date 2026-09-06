import { bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function deflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate')
  const writer = stream.writable.getWriter()
  const writing = writer.write(raw).then(() => writer.close())
  writing.catch(() => undefined)
  const reader = stream.readable.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    parts.push(value)
  }
  await writing
  return concat(parts)
}

/**
 * PNG grayscale 1 bit (IHDR depth 1, color 0): trong PNG 1 là trắng, nên mỗi hàng là byte filter 0 rồi các
 * byte của Bitmap đảo bit. IDAT nén bằng `CompressionStream('deflate')` — đúng định dạng zlib PNG cần.
 * Không dùng canvas nên chạy được cả trong Node (máy in ảo) lẫn trình duyệt (tải trọng `rawbt:`).
 */
export async function encodePng1(bitmap: Bitmap): Promise<Uint8Array> {
  if (bitmap.width < 1 || bitmap.height < 1) {
    throw new Error(`PNG không có kích cỡ 0 (bitmap ${bitmap.width}×${bitmap.height})`)
  }
  const stride = bytesPerRow(bitmap.width)
  const raw = new Uint8Array((1 + stride) * bitmap.height)
  for (let y = 0; y < bitmap.height; y++) {
    const src = y * stride
    const dst = y * (1 + stride) + 1
    for (let i = 0; i < stride; i++) raw[dst + i] = ~(bitmap.data[src + i] ?? 0) & 0xff
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, bitmap.width)
  view.setUint32(4, bitmap.height)
  ihdr[8] = 1
  ihdr[9] = 0

  const idat = await deflate(raw)
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))])
}
