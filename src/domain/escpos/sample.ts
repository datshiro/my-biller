import { DOTS_PER_LINE, bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'

export const SAMPLE_HEIGHT = 180

/**
 * Phần thuần của tờ IN THỬ: thước 576 chấm (vạch nhỏ mỗi 8, vạch lớn mỗi 64 và ở chấm cuối), thanh đen
 * hết khổ, thanh nửa khổ, bàn cờ 8×8. Đo bằng thước kẻ trên giấy là biết máy có đúng 576 chấm/72mm không.
 * Vẽ bằng bit, không canvas, để script Node in được mà không cần trình duyệt.
 */
export function sampleBitmap(): Bitmap {
  const width = DOTS_PER_LINE
  const stride = bytesPerRow(width)
  const data = new Uint8Array(stride * SAMPLE_HEIGHT)
  const set = (x: number, y: number) => {
    const k = y * stride + (x >> 3)
    data[k] = (data[k] ?? 0) | (0x80 >> (x & 7))
  }

  for (let y = 0; y < 20; y++) for (let x = 0; x < width; x += 8) set(x, y)
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < width; x += 64) set(x, y)
    set(width - 1, y)
  }
  data.fill(0xff, 50 * stride, 70 * stride)
  for (let y = 80; y < 100; y++) data.fill(0xff, y * stride, y * stride + stride / 2)
  for (let y = 110; y < 170; y++) {
    const odd = ((y - 110) >> 3) & 1
    for (let bx = 0; bx < stride; bx++) if ((bx & 1) === odd) data[y * stride + bx] = 0xff
  }
  return { width, height: SAMPLE_HEIGHT, data }
}
