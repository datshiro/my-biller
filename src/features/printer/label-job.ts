import { toCanvas } from 'html-to-image'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { toBitmap } from '@/domain/escpos/threshold'
import { encodeLabels, labelDots, type LabelSize } from '@/domain/tspl/encode'

/**
 * Mỗi món chụp node tem của nó (dựng sẵn đúng khổ, 1px = 1 chấm) MỘT lần, rồi lặp ảnh đó `copies` tem.
 * Ảnh lệch khổ → ném ngay, như chốt chặn 576 chấm của phiếu.
 */
export async function buildLabelJob(
  items: readonly { node: HTMLElement; copies: number }[],
  size: LabelSize,
): Promise<Uint8Array> {
  await document.fonts.ready
  const dots = labelDots(size)
  const labels: Bitmap[] = []
  // Chụp tuần tự như ảnh phiếu: song song thì máy yếu dễ hết bộ nhớ canvas.
  for (const { node, copies } of items) {
    if (copies < 1) continue
    const canvas = await toCanvas(node, { pixelRatio: 1, backgroundColor: '#ffffff' })
    if (canvas.width !== dots.width || canvas.height !== dots.height) {
      throw new Error(`Ảnh tem ${canvas.width}×${canvas.height} chấm, cần đúng ${dots.width}×${dots.height}.`)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Không đọc được ảnh tem trên máy này.')
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const bitmap = toBitmap({ width, height, data })
    for (let i = 0; i < copies; i++) labels.push(bitmap)
  }
  return encodeLabels(labels, size)
}
