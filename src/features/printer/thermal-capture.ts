import { toCanvas } from 'html-to-image'
import { DOTS_PER_LINE } from '@/domain/escpos/bitmap'
import type { RgbaImage } from '@/domain/escpos/bitmap'

/**
 * Cố định, KHÔNG qua `PIXEL_BUDGET`: node phiếu rộng 360px × 1,6 = 576 chấm đúng khổ máy in. Đây là
 * chốt chặn bề rộng (bất biến #2) — `encodeJob` ném nếu ảnh ≠ 576, nên tỉ lệ này không được co giãn.
 */
export const THERMAL_RATIO = 1.6

/**
 * Chụp DOM bản nhiệt thành RGBA 576 chấm. Chờ `document.fonts.ready` như `renderReceiptPng` — dấu
 * tiếng Việt rơi về font hệ thống nếu font chưa nạp. Đọc `getImageData` ở kích cỡ canvas ĐÃ nhân
 * `pixelRatio` (không dùng `toPixelData` — nó đọc ở kích cỡ chưa nhân). Ảnh ≠ 576 rộng → ném ngay.
 */
export async function captureThermal(node: HTMLElement): Promise<RgbaImage> {
  await document.fonts.ready
  const canvas = await toCanvas(node, { pixelRatio: THERMAL_RATIO, backgroundColor: '#ffffff' })
  if (canvas.width !== DOTS_PER_LINE) {
    throw new Error(
      `Bản in rộng ${canvas.width} chấm, cần đúng ${DOTS_PER_LINE} — kiểm tra bề ngang node bản nhiệt.`,
    )
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không đọc được ảnh bản in trên máy này.')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { width, height, data }
}
