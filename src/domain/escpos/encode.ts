import { DOTS_PER_LINE, bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'

export const ESC = 0x1b
export const GS = 0x1d
/** Số hàng mỗi lệnh `GS v 0`. 128 hàng × 72 byte = 9KB một khối, vừa bộ đệm máy in phổ thông. */
export const ROWS_PER_BAND = 128
/** Số đơn vị đẩy giấy trước khi cắt hờ (`GS V 66 n`). Đơn vị thật của n xác nhận ở chuyến quán. */
export const CUT_FEED = 5

export interface EncodeOptions {
  cut?: boolean
  feed?: number
  rowsPerBand?: number
}

/**
 * `ESC @` · các khối `GS v 0` · `GS V 66 n`. Chỉ nhận đúng khổ 576: ảnh lệch khổ là lỗi ở khâu dựng,
 * không phải việc của bộ mã hoá co giãn cho vừa.
 */
export function encodeJob(bitmap: Bitmap, options: EncodeOptions = {}): Uint8Array {
  const { cut = true, feed = CUT_FEED, rowsPerBand = ROWS_PER_BAND } = options
  if (bitmap.width !== DOTS_PER_LINE) {
    throw new Error(`Bitmap rộng ${bitmap.width} chấm, máy in cần đúng ${DOTS_PER_LINE}`)
  }
  if (!Number.isInteger(bitmap.height) || bitmap.height < 0) {
    throw new Error(`Bitmap cao ${bitmap.height} hàng: phải là số nguyên không âm`)
  }
  if (!Number.isInteger(rowsPerBand) || rowsPerBand < 1 || rowsPerBand > 0xffff) {
    throw new Error(`rowsPerBand phải là số nguyên 1–65535, nhận: ${rowsPerBand}`)
  }
  if (!Number.isInteger(feed) || feed < 0 || feed > 255) {
    throw new Error(`feed phải là số nguyên 0–255, nhận: ${feed}`)
  }
  const stride = bytesPerRow(bitmap.width)
  if (bitmap.data.length !== stride * bitmap.height) {
    throw new Error(
      `Bitmap ${bitmap.width}×${bitmap.height} cần ${stride * bitmap.height} byte, có ${bitmap.data.length}`,
    )
  }

  const bands = Math.ceil(bitmap.height / rowsPerBand)
  const out = new Uint8Array(2 + bands * 8 + bitmap.data.length + (cut ? 4 : 0))
  let p = 0
  out[p++] = ESC
  out[p++] = 0x40
  for (let y = 0; y < bitmap.height; y += rowsPerBand) {
    const rows = Math.min(rowsPerBand, bitmap.height - y)
    out.set([GS, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8], p)
    p += 8
    out.set(bitmap.data.subarray(y * stride, (y + rows) * stride), p)
    p += rows * stride
  }
  if (cut) out.set([GS, 0x56, 66, feed], p)
  return out
}
