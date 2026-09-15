import { bytesPerRow } from './bitmap.ts'
import type { Bitmap, RgbaImage } from './bitmap.ts'

/** Độ sáng dưới mức này là mực. 176 giữ được nét chữ mảnh mà không kéo nền xám nhạt thành đen. */
export const INK_THRESHOLD = 176

/**
 * Ngưỡng đơn, không dither: phiếu là chữ đen trên nền trắng, dither chỉ làm chữ lỗ chỗ.
 * Chấm trong suốt được ghép lên nền trắng trước khi đo độ sáng. Tính bằng số nguyên (×1000) để xám đúng
 * bằng ngưỡng không bị số thực đẩy xuống thành mực.
 */
export function toBitmap(image: RgbaImage, threshold = INK_THRESHOLD): Bitmap {
  const { width, height, data } = image
  if (data.length !== width * height * 4) {
    throw new Error(`Ảnh ${width}×${height} cần ${width * height * 4} byte RGBA, có ${data.length}`)
  }
  const stride = bytesPerRow(width)
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = data[i + 3] ?? 0
      const onWhite = (channel: number) => Math.round((channel * alpha + 255 * (255 - alpha)) / 255)
      const luma1000 =
        299 * onWhite(data[i] ?? 0) + 587 * onWhite(data[i + 1] ?? 0) + 114 * onWhite(data[i + 2] ?? 0)
      if (luma1000 < threshold * 1000) {
        const k = y * stride + (x >> 3)
        out[k] = (out[k] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return { width, height, data: out }
}
