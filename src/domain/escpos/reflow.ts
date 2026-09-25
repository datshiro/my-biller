import { DOTS_PER_LINE, bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'
import { LINE_DOTS } from './stream.ts'
import type { Align, Block } from './stream.ts'

/** Font A của máy in 80mm: ô 12×24 chấm, 48 cột. Người gửi canh cột bằng dấu cách theo đúng lưới này. */
export const CELL_DOTS = 12
export const GLYPH_DOTS = 24
const TAB_COLUMNS = 8

export interface Glyph {
  ch: string
  x: number
  width: number
  height: number
  bold: boolean
  underline: boolean
}

export interface TextRow {
  height: number
  glyphs: Glyph[]
}

export type LaidBlock = { kind: 'text'; row: TextRow } | { kind: 'blank'; height: number } | { kind: 'image'; bitmap: Bitmap }

/** Vẽ một hàng chữ thành bitmap đúng `DOTS_PER_LINE × row.height`. Hiện thực canvas nằm ở tầng features. */
export type RasterizeRow = (row: TextRow) => Bitmap

/** NFC gộp dấu tiếng Việt vào chữ; dấu nào còn rời (không có dạng dựng sẵn) bám vào chữ trước, cùng một ô. */
function cells(text: string): string[] {
  const out: string[] = []
  for (const ch of text.normalize('NFC')) {
    if (/\p{M}/u.test(ch) && out.length > 0) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

function shift(align: Align, used: number): number {
  if (align === 'center') return Math.floor((DOTS_PER_LINE - used) / 2)
  if (align === 'right') return DOTS_PER_LINE - used
  return 0
}

/** Xuống hàng theo ô như máy in thật (cắt giữa chữ khi chạm lề), rồi mới căn lề từng hàng. */
function layoutLine(block: Extract<Block, { kind: 'line' }>): TextRow[] {
  const rows: Glyph[][] = [[]]
  let x = 0
  for (const run of block.runs) {
    const width = CELL_DOTS * run.style.widthMul
    const height = GLYPH_DOTS * run.style.heightMul
    for (const ch of cells(run.text)) {
      if (ch === '\t') {
        const tab = CELL_DOTS * TAB_COLUMNS
        x = Math.min(DOTS_PER_LINE, (Math.floor(x / tab) + 1) * tab)
        continue
      }
      if (x + width > DOTS_PER_LINE) {
        rows.push([])
        x = 0
      }
      rows[rows.length - 1]?.push({ ch, x, width, height, bold: run.style.bold, underline: run.style.underline })
      x += width
    }
  }
  return rows.map((glyphs) => {
    const last = glyphs[glyphs.length - 1]
    const offset = shift(block.align, last ? last.x + last.width : 0)
    const tallest = glyphs.reduce((h, g) => Math.max(h, g.height), GLYPH_DOTS)
    return { height: tallest + LINE_DOTS - GLYPH_DOTS, glyphs: glyphs.map((g) => ({ ...g, x: g.x + offset })) }
  })
}

/** Ảnh hẹp hơn khổ → đệm ra 576 chấm, dời theo căn lề (theo byte, đủ mịn cho logo/QR). */
function padImage(bitmap: Bitmap, align: Align): Bitmap {
  const inStride = bytesPerRow(bitmap.width)
  const outStride = bytesPerRow(DOTS_PER_LINE)
  const offset = Math.floor(shift(align, inStride * 8) / 8)
  const data = new Uint8Array(outStride * bitmap.height)
  for (let y = 0; y < bitmap.height; y++) {
    data.set(bitmap.data.subarray(y * inStride, (y + 1) * inStride), y * outStride + offset)
  }
  return { width: DOTS_PER_LINE, height: bitmap.height, data }
}

export function layoutBlocks(blocks: Block[]): LaidBlock[] {
  return blocks.flatMap((block): LaidBlock[] => {
    if (block.kind === 'feed') return [{ kind: 'blank', height: block.dots }]
    if (block.kind === 'raster') return [{ kind: 'image', bitmap: padImage(block.bitmap, block.align) }]
    return layoutLine(block).map((row) => ({ kind: 'text', row }))
  })
}

export function composeBitmap(laid: LaidBlock[], rasterize: RasterizeRow): Bitmap {
  const parts = laid.map((block): Bitmap => {
    if (block.kind === 'image') return block.bitmap
    if (block.kind === 'blank') {
      return { width: DOTS_PER_LINE, height: block.height, data: new Uint8Array(bytesPerRow(DOTS_PER_LINE) * block.height) }
    }
    const part = rasterize(block.row)
    if (part.width !== DOTS_PER_LINE || part.height !== block.row.height) {
      throw new Error(`Hàng chữ vẽ ra ${part.width}×${part.height}, cần ${DOTS_PER_LINE}×${block.row.height}`)
    }
    return part
  })
  const data = new Uint8Array(parts.reduce((n, part) => n + part.data.length, 0))
  let offset = 0
  for (const part of parts) {
    data.set(part.data, offset)
    offset += part.data.length
  }
  return { width: DOTS_PER_LINE, height: parts.reduce((h, part) => h + part.height, 0), data }
}
