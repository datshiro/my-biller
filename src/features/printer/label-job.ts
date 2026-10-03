import { toCanvas } from 'html-to-image'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { toBitmap } from '@/domain/escpos/threshold'
import { labelSequence } from '@/domain/label-count'
import type { LabelWatermark } from '@/domain/schema'
import { encodeLabels, labelDots, type LabelImage, type LabelSize } from '@/domain/tspl/encode'
import { compositeUnder, renderLogoLayer, STRENGTH_CELLS } from '@/domain/watermark'
import { watermarkBox } from '@/features/receipt/label-layout'

export interface LabelWatermarkJob {
  logo: Bitmap
  config: LabelWatermark
}

/**
 * Lớp logo cỡ đúng tem, dựng MỘT lần cho cả lệnh in. Giữa tem in chấm thưa theo mức đậm; logo nhỏ ở góc in đặc vì
 * làm mờ ở cỡ ~6 mm thì không còn nhận ra. Ô số thứ tự `i/n` không cần xoá: hộp logo không bao giờ xuống tới hàng đó
 * (`label-layout.test.ts`).
 */
export function buildWatermarkLayer(size: LabelSize, watermark: LabelWatermarkJob): Bitmap | null {
  const { config, logo } = watermark
  if (!config.enabled) return null
  const dots = labelDots(size)
  const layer = renderLogoLayer(
    dots,
    logo,
    watermarkBox(size, config.position),
    config.position === 'corner' ? { kind: 'solid' } : { kind: 'dither', cells: STRENGTH_CELLS[config.strength] },
  )
  return layer
}

/**
 * Mỗi món có một hay nhiều node tem (các trang của một ly). Mỗi node chụp MỘT lần, rồi cả bộ trang được
 * lặp `copies` lần theo thứ tự của `labelSequence`. Ảnh lệch khổ → ném ngay, như chốt chặn 576 chấm của
 * phiếu.
 */
export async function buildLabelJob(
  items: readonly { nodes: readonly HTMLElement[]; copies: number }[],
  size: LabelSize,
  watermark: LabelWatermarkJob | null = null,
): Promise<Uint8Array> {
  await document.fonts.ready
  const dots = labelDots(size)
  const layer = watermark ? buildWatermarkLayer(size, watermark) : null
  // Chụp tuần tự như ảnh phiếu: song song thì máy yếu dễ hết bộ nhớ canvas.
  const captured: Bitmap[][] = []
  for (const { nodes, copies } of items) {
    const pages: Bitmap[] = []
    if (copies >= 1) {
      for (const node of nodes) {
        const canvas = await toCanvas(node, { pixelRatio: 1, backgroundColor: '#ffffff' })
        if (canvas.width !== dots.width || canvas.height !== dots.height) {
          throw new Error(`Ảnh tem ${canvas.width}×${canvas.height} chấm, cần đúng ${dots.width}×${dots.height}.`)
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Không đọc được ảnh tem trên máy này.')
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const text = toBitmap({ width, height, data })
        // Ghép ngay lúc chụp để mỗi trang vẫn là MỘT object: `encodeLabels` đảo bit một lần theo object rồi dùng lại.
        pages.push(layer ? compositeUnder(text, layer, 2) : text)
      }
    }
    captured.push(pages)
  }
  const labels: LabelImage[] = labelSequence(items.map(({ nodes, copies }) => ({ pages: nodes.length, copies }))).flatMap(
    ({ item, page, counter }) => {
      const bitmap = captured[item]?.[page]
      return bitmap ? [{ bitmap, counter }] : []
    },
  )
  return encodeLabels(labels, size)
}
