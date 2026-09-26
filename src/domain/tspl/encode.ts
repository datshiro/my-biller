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

/**
 * Chỗ máy in vẽ số thứ tự của tem cuối (chuỗi dài nhất) — góc dưới phải. Tem từ 40 mm cao trở lên còn
 * chỗ nên phóng đôi cho đọc được từ xa. Dùng chung với `LabelView` để chữ trên tem chừa đúng chỗ này.
 */
export function counterBox(size: LabelSize, count: number): { x: number; y: number; scale: number } {
  const dots = labelDots(size)
  const scale = dots.height >= 40 * DOTS_PER_MM ? 2 : 1
  const width = COUNTER_FONT.width * scale * `${count}/${count}`.length
  return {
    x: Math.max(0, dots.width - width - COUNTER_MARGIN),
    y: dots.height - COUNTER_FONT.height * scale - COUNTER_MARGIN,
    scale,
  }
}

const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0))

/**
 * Một lệnh TSPL, mỗi phần tử của `labels` là một tem (nhiều tem cùng món dùng chung một ảnh). Số thứ tự
 * `i/n` in bằng font dựng sẵn của máy thay vì chụp lại ảnh cho từng tem — chữ số ASCII không cần dấu
 * tiếng Việt, và chụp DOM n lần làm 30 tem chờ cả chục giây.
 *
 * Ảnh phải đúng khổ tem: lệch khổ là lỗi ở khâu dựng, bộ mã hoá không co giãn cho vừa.
 */
export function encodeLabels(labels: readonly Bitmap[], size: LabelSize): Uint8Array {
  const dots = labelDots(size)
  const count = labels.length
  if (count < 1) throw new Error('Không có tem nào để in.')
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
  const { scale, y: counterY } = counterBox(size, count)
  labels.forEach((bitmap, index) => {
    const counter = `${index + 1}/${count}`
    const counterX = Math.max(0, dots.width - COUNTER_FONT.width * scale * counter.length - COUNTER_MARGIN)
    parts.push(
      ascii(`CLS\r\nBITMAP 0,0,${stride},${dots.height},0,`),
      rasterOf(bitmap),
      ascii(`\r\nTEXT ${counterX},${counterY},"${COUNTER_FONT.name}",0,${scale},${scale},"${counter}"\r\nPRINT 1,1\r\n`),
    )
  })

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
