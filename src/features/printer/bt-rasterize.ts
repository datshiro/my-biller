import { DOTS_PER_LINE } from '@/domain/escpos/bitmap'
import type { Bitmap } from '@/domain/escpos/bitmap'
import { CELL_DOTS, GLYPH_DOTS, type TextRow } from '@/domain/escpos/reflow'
import { toBitmap } from '@/domain/escpos/threshold'

const FONT = "'Be Vietnam Pro', sans-serif"

/** Font phải nạp xong trước khi vẽ, không thì dấu tiếng Việt rơi về font hệ thống (như `captureThermal`). */
export async function loadRowFonts(): Promise<void> {
  await Promise.all([document.fonts.load(`400 24px ${FONT}`), document.fonts.load(`700 24px ${FONT}`)])
}

/** Khoảng giãn dòng nằm TRÊN chữ: dấu chồng của chữ hoa tiếng Việt (Ể, Ỗ) cần chỗ đó, chân chữ thì không. */
function baseline(row: TextRow, glyphHeight: number): number {
  return row.height - Math.round(glyphHeight * 0.22)
}

/**
 * Một hàng chữ → bitmap 576 chấm. Mỗi chữ vẽ giữa ô của nó (co lại nếu rộng hơn ô): font app không đơn
 * cách, nhưng người gửi canh cột theo lưới 48 ô nên giữ ô cố định mới thẳng cột giá tiền.
 */
export function rasterizeRow(row: TextRow): Bitmap {
  const canvas = document.createElement('canvas')
  canvas.width = DOTS_PER_LINE
  canvas.height = row.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Không vẽ được bản in trên máy này.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'alphabetic'

  for (const g of row.glyphs) {
    if (g.ch.trim()) {
      ctx.font = `${g.bold ? 700 : 400} ${Math.round(g.height * 0.9)}px ${FONT}`
      const measured = ctx.measureText(g.ch).width
      // Cỡ font theo chiều cao; chữ chỉ nới ngang (GS ! 0x10) thì kéo giãn theo tỉ lệ rộng/cao của ô.
      const stretch = (g.width / CELL_DOTS) / (g.height / GLYPH_DOTS)
      const scale = Math.min(g.width / measured, stretch)
      ctx.setTransform(scale, 0, 0, 1, g.x + (g.width - measured * scale) / 2, baseline(row, g.height))
      ctx.fillText(g.ch, 0, 0)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    if (g.underline) ctx.fillRect(g.x, baseline(row, g.height) + 2, g.width, 2)
  }
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return toBitmap({ width, height, data })
}
