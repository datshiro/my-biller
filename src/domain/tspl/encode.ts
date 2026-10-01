import { bytesPerRow } from '../escpos/bitmap.ts'
import type { Bitmap } from '../escpos/bitmap.ts'

/** 203 dpi ≈ 8 chấm/mm — độ phân giải XPrinter XP-365B. */
export const DOTS_PER_MM = 8

export interface LabelSize {
  widthMm: number
  heightMm: number
  gapMm: number
}

/** Font dựng sẵn "3" của TSPL: 16×24 chấm mỗi ký tự — đủ đọc khi cầm ly, không chiếm chỗ của phần chữ. */
const COUNTER_FONT = { name: '3', width: 16, height: 24 }
const COUNTER_MARGIN = 8

/** Cao của hàng số thứ tự ở đáy tem; `LabelView` chừa đúng chiều cao này để chữ không đè lên số. */
export const COUNTER_HEIGHT = COUNTER_FONT.height

/** Một tem: ảnh đã dựng và số thứ tự `i/n` máy in tự vẽ (các tem tiếp của một ly mang chung số). */
export interface LabelImage {
  bitmap: Bitmap
  counter: string
}

export function labelDots(size: LabelSize): { width: number; height: number } {
  return { width: size.widthMm * DOTS_PER_MM, height: size.heightMm * DOTS_PER_MM }
}

/**
 * Chỗ máy in vẽ số thứ tự — góc dưới phải. `count` là số ly của đơn, nên chuỗi dài nhất là `count/count`.
 * Dùng chung với `LabelView` để chữ trên tem chừa đúng chỗ này.
 */
export function counterBox(size: LabelSize, count: number): { x: number; y: number } {
  const dots = labelDots(size)
  const width = COUNTER_FONT.width * `${count}/${count}`.length
  return {
    x: Math.max(0, dots.width - width - COUNTER_MARGIN),
    y: dots.height - COUNTER_FONT.height - COUNTER_MARGIN,
  }
}

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

/**
 * Một lệnh TSPL, mỗi phần tử của `labels` là một tem (nhiều tem cùng ảnh dùng chung một bitmap). Số thứ tự
 * do người gọi đặt: một ly có ghi chú dài ra nhiều tem, các tem đó mang chung số `i/n` của ly. Số in bằng
 * font dựng sẵn của máy thay vì chụp lại ảnh cho từng tem — chữ số ASCII không cần dấu tiếng Việt, và
 * chụp DOM n lần làm 30 tem chờ cả chục giây.
 *
 * Ảnh phải đúng khổ tem: lệch khổ là lỗi ở khâu dựng, bộ mã hoá không co giãn cho vừa.
 */
export function encodeLabels(labels: readonly LabelImage[], size: LabelSize): Uint8Array {
  const dots = labelDots(size)
  if (labels.length < 1) throw new Error('Không có tem nào để in.')
  const stride = bytesPerRow(dots.width)

  // TSPL ngược ESC/POS: bit 0 là chấm đen. Đảo mỗi ảnh một lần dù nó lặp cho nhiều tem.
  const rasters = new Map<Bitmap, Uint8Array>()
  const rasterOf = (bitmap: Bitmap) => {
    let raster = rasters.get(bitmap)
    if (!raster) {
      if (bitmap.width !== dots.width || bitmap.height !== dots.height) {
        throw new Error(
          `Ảnh tem ${bitmap.width}×${bitmap.height} chấm, khổ ${size.widthMm}×${size.heightMm} mm cần ${dots.width}×${dots.height}`,
        )
      }
      if (bitmap.data.length !== stride * bitmap.height) {
        throw new Error(`Ảnh tem cần ${stride * bitmap.height} byte, có ${bitmap.data.length}`)
      }
      raster = bitmap.data.map((byte) => ~byte & 0xff)
      rasters.set(bitmap, raster)
    }
    return raster
  }

  const parts: Uint8Array[] = [
    ascii(
      `SIZE ${size.widthMm} mm,${size.heightMm} mm\r\n` +
        `GAP ${size.gapMm} mm,0 mm\r\n` +
        'DIRECTION 1,0\r\n' +
        'REFERENCE 0,0\r\n',
    ),
  ]
  const { y: counterY } = counterBox(size, 1)
  for (const { bitmap, counter } of labels) {
    const counterX = Math.max(0, dots.width - COUNTER_FONT.width * counter.length - COUNTER_MARGIN)
    parts.push(
      ascii(`CLS\r\nBITMAP 0,0,${stride},${dots.height},0,`),
      rasterOf(bitmap),
      ascii(`\r\nTEXT ${counterX},${counterY},"${COUNTER_FONT.name}",0,1,1,"${counter}"\r\nPRINT 1,1\r\n`),
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
