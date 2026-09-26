import { toCanvas } from 'html-to-image'
import { toBitmap } from '@/domain/escpos/threshold'
import { encodeLabels, labelDots, type LabelSize } from '@/domain/tspl/encode'

/**
 * Chụp node tem (dựng sẵn đúng khổ, 1px = 1 chấm) một lần rồi mã hoá `count` tem TSPL. Ảnh lệch
 * khổ → ném ngay, như chốt chặn 576 chấm của phiếu.
 */
export async function buildLabelJob(node: HTMLElement, size: LabelSize, count: number): Promise<Uint8Array> {
  await document.fonts.ready
  const dots = labelDots(size)
  const canvas = await toCanvas(node, { pixelRatio: 1, backgroundColor: '#ffffff' })
  if (canvas.width !== dots.width || canvas.height !== dots.height) {
    throw new Error(`Ảnh tem ${canvas.width}×${canvas.height} chấm, cần đúng ${dots.width}×${dots.height}.`)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không đọc được ảnh tem trên máy này.')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return encodeLabels(toBitmap({ width, height, data }), size, count)
}
