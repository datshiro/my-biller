import { toCanvas } from 'html-to-image'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { toBitmap } from '@/domain/escpos/threshold'
import { labelSequence } from '@/domain/label-count'
import { encodeLabels, labelDots, type LabelImage, type LabelSize } from '@/domain/tspl/encode'

/**
 * Mỗi món có một hay nhiều node tem (các trang của một ly). Mỗi node chụp MỘT lần, rồi cả bộ trang được
 * lặp `copies` lần theo thứ tự của `labelSequence`. Ảnh lệch khổ → ném ngay, như chốt chặn 576 chấm của
 * phiếu.
 */
export async function buildLabelJob(
  items: readonly { nodes: readonly HTMLElement[]; copies: number }[],
  size: LabelSize,
): Promise<Uint8Array> {
  await document.fonts.ready
  const dots = labelDots(size)
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
        pages.push(toBitmap({ width, height, data }))
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
