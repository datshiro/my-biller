import { toBase64 } from '@/domain/base64'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { encodePng1 } from '@/domain/escpos/png-1bit'
import { toBitmap } from '@/domain/escpos/threshold'
import { SHOP_LOGO_MAX_CHARS } from '@/domain/schema'
import { cropBitmap, inkBounds, renderLogoLayer } from '@/domain/watermark'

/** Cạnh dài của logo đã lưu, theo chấm in. Đủ cho logo giữa tem 72×100 mà PNG đen trắng vẫn chỉ vài KB. */
export const SHOP_LOGO_LONG_EDGE = 400
const DECODE_LONG_EDGE = 1024
/**
 * Trình duyệt giải mã ảnh ở độ phân giải gốc trước khi co: ảnh chụp camera hàng chục megapixel cần vài trăm MB bộ nhớ
 * và làm treo app trên máy yếu. Logo thật chỉ vài chục KB.
 */
export const SHOP_LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024

function bitmapOf(source: CanvasImageSource, width: number, height: number): Bitmap {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không đọc được ảnh trên máy này.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  return toBitmap({ width, height, data })
}

/**
 * Ảnh người bán chọn → PNG đen trắng đúng như sẽ in: cùng ngưỡng với chữ trên tem, cắt sát nét (logo vuông thường dư
 * nhiều lề trắng), co cạnh dài về `SHOP_LOGO_LONG_EDGE`. Bản lưu chính là bản xem trước.
 */
export async function logoDataUrlFromFile(file: Blob): Promise<string> {
  if (file.size > SHOP_LOGO_MAX_FILE_BYTES) {
    throw new Error('Ảnh quá lớn — chọn file logo dưới 5 MB, không phải ảnh chụp từ camera.')
  }
  let image: ImageBitmap
  try {
    image = await createImageBitmap(file)
  } catch {
    throw new Error('Không đọc được ảnh này. Chọn ảnh PNG hoặc JPG.')
  }
  const shrink = Math.min(1, DECODE_LONG_EDGE / Math.max(image.width, image.height))
  const decoded = bitmapOf(
    image,
    Math.max(1, Math.round(image.width * shrink)),
    Math.max(1, Math.round(image.height * shrink)),
  )
  image.close()

  const bounds = inkBounds(decoded)
  if (!bounds) throw new Error('Ảnh không có nét nào để in — chọn ảnh logo nền trắng, nét đậm.')
  const cropped = cropBitmap(decoded, bounds)
  const scale = Math.min(1, SHOP_LOGO_LONG_EDGE / Math.max(cropped.width, cropped.height))
  const width = Math.max(1, Math.round(cropped.width * scale))
  const height = Math.max(1, Math.round(cropped.height * scale))
  const logo =
    scale === 1 ? cropped : renderLogoLayer({ width, height }, cropped, { x: 0, y: 0, width, height }, { kind: 'solid' })

  const dataUrl = `data:image/png;base64,${toBase64(await encodePng1(logo))}`
  if (dataUrl.length > SHOP_LOGO_MAX_CHARS) throw new Error('Logo quá chi tiết để lưu — chọn ảnh đơn giản hơn.')
  return dataUrl
}

export async function decodeLogo(dataUrl: string): Promise<Bitmap> {
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob())
  try {
    return bitmapOf(image, image.width, image.height)
  } finally {
    image.close()
  }
}
