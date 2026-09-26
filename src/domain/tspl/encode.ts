import { bytesPerRow } from '../escpos/bitmap.ts'
import type { Bitmap } from '../escpos/bitmap.ts'

/** 203 dpi ≈ 8 chấm/mm — độ phân giải XPrinter XP-365B. */
export const DOTS_PER_MM = 8

export interface LabelSize {
  widthMm: number
  heightMm: number
  gapMm: number
}

/** Font dựng sẵn "4" của TSPL: 24×32 chấm mỗi ký tự, đủ to để đọc số thứ tự tem từ xa. */
const COUNTER_FONT = { name: '4', width: 24, height: 32 }
const COUNTER_MARGIN = 8

export function labelDots(size: LabelSize): { width: number; height: number } {
  return { width: size.widthMm * DOTS_PER_MM, height: size.heightMm * DOTS_PER_MM }
}

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

/**
 * Một lệnh TSPL gửi `count` tem: mỗi tem là cùng một ảnh (tên quán, mã đơn…) cộng số thứ tự `i/n`
 * góc dưới phải. Số thứ tự in bằng font dựng sẵn thay vì chụp lại ảnh cho từng tem — chữ số ASCII
 * không cần dấu tiếng Việt, và chụp DOM n lần làm 30 tem chờ cả chục giây.
 *
 * Ảnh phải đúng khổ tem: lệch khổ là lỗi ở khâu dựng, bộ mã hoá không co giãn cho vừa.
 */
export function encodeLabels(bitmap: Bitmap, size: LabelSize, count: number): Uint8Array {
  const dots = labelDots(size)
  if (bitmap.width !== dots.width || bitmap.height !== dots.height) {
    throw new Error(
      `Ảnh tem ${bitmap.width}×${bitmap.height} chấm, khổ ${size.widthMm}×${size.heightMm} mm cần ${dots.width}×${dots.height}`,
    )
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Số tem phải là số nguyên dương, nhận: ${count}`)
  }
  const stride = bytesPerRow(bitmap.width)
  if (bitmap.data.length !== stride * bitmap.height) {
    throw new Error(`Ảnh tem cần ${stride * bitmap.height} byte, có ${bitmap.data.length}`)
  }

  // TSPL ngược ESC/POS: bit 0 là chấm đen. Bit đệm cuối hàng thành 1 (trắng) nên không in vệt mép phải.
  const raster = bitmap.data.map((byte) => ~byte & 0xff)

  const parts: Uint8Array[] = [
    ascii(
      `SIZE ${size.widthMm} mm,${size.heightMm} mm\r\n` +
        `GAP ${size.gapMm} mm,0 mm\r\n` +
        'DIRECTION 1,0\r\n' +
        'REFERENCE 0,0\r\n',
    ),
  ]
  // Tem từ 40 mm cao trở lên còn nửa dưới trống: phóng đôi số thứ tự cho đọc được từ xa.
  const scale = dots.height >= 40 * DOTS_PER_MM ? 2 : 1
  const counterY = dots.height - COUNTER_FONT.height * scale - COUNTER_MARGIN
  for (let i = 1; i <= count; i++) {
    const counter = `${i}/${count}`
    const counterX = Math.max(0, dots.width - COUNTER_FONT.width * scale * counter.length - COUNTER_MARGIN)
    parts.push(
      ascii(`CLS\r\nBITMAP 0,0,${stride},${bitmap.height},0,`),
      raster,
      ascii(`\r\nTEXT ${counterX},${counterY},"${COUNTER_FONT.name}",0,${scale},${scale},"${counter}"\r\nPRINT 1,1\r\n`),
    )
  }

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
