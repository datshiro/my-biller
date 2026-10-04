import { toCanvas } from 'html-to-image'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { toBitmap } from '@/domain/escpos/threshold'
import { labelSequence } from '@/domain/label-count'
import type { LabelWatermark } from '@/domain/schema'
import { encodeLabels, labelDots, type LabelImage, type LabelSize } from '@/domain/tspl/encode'
import { compositeUnder, renderLogoLayer, STRENGTH_CELLS } from '@/domain/watermark'
import { logoPlacement, watermarkBox } from '@/features/receipt/label-layout'

/** Viền trắng quanh nét chữ khi ghép lớp logo dưới chữ — in tem và tem xem trước dùng chung. */
const WATERMARK_HALO = 2

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
  const placement = logoPlacement(config)
  const layer = renderLogoLayer(
    dots,
    logo,
    watermarkBox(size, placement),
    placement === 'corner' ? { kind: 'solid' } : { kind: 'dither', cells: STRENGTH_CELLS[config.strength] },
  )
  return layer
}

/** Chụp một node tem ra ảnh 1-bit đúng khổ. Ảnh lệch khổ → ném ngay, như chốt chặn 576 chấm của phiếu. */
async function captureLabel(node: HTMLElement, size: LabelSize): Promise<Bitmap> {
  const dots = labelDots(size)
  const canvas = await toCanvas(node, { pixelRatio: 1, backgroundColor: '#ffffff' })
  if (canvas.width !== dots.width || canvas.height !== dots.height) {
    throw new Error(`Ảnh tem ${canvas.width}×${canvas.height} chấm, cần đúng ${dots.width}×${dots.height}.`)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không đọc được ảnh tem trên máy này.')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return toBitmap({ width, height, data })
}

/**
 * Ảnh một tem đúng như sẽ in, để xem trước ở Cài đặt: cùng hàm chụp, cùng ngưỡng, cùng lớp logo và cùng phép ghép
 * với `buildLabelJob`. Chỉ thiếu số thứ tự `i/n` vì máy in tự vẽ.
 */
export async function renderLabelPreview(
  node: HTMLElement,
  size: LabelSize,
  watermark: LabelWatermarkJob | null,
): Promise<Bitmap> {
  await document.fonts.ready
  const text = await captureLabel(node, size)
  const layer = watermark ? buildWatermarkLayer(size, watermark) : null
  return layer ? compositeUnder(text, layer, WATERMARK_HALO) : text
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
  const layer = watermark ? buildWatermarkLayer(size, watermark) : null
  // Chụp tuần tự như ảnh phiếu: song song thì máy yếu dễ hết bộ nhớ canvas.
  const captured: Bitmap[][] = []
  for (const { nodes, copies } of items) {
    const pages: Bitmap[] = []
    if (copies >= 1) {
      for (const node of nodes) {
        const text = await captureLabel(node, size)
        // Ghép ngay lúc chụp để mỗi trang vẫn là MỘT object: `encodeLabels` đảo bit một lần theo object rồi dùng lại.
        pages.push(layer ? compositeUnder(text, layer, WATERMARK_HALO) : text)
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
