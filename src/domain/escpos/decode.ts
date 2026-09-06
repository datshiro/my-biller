import { DOTS_PER_LINE, bytesPerRow } from './bitmap.ts'
import type { Bitmap } from './bitmap.ts'
import { ESC, GS } from './encode.ts'

export interface DecodedJob {
  bitmap: Bitmap
  commands: string[]
}

const hex = (b: number) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`

/**
 * Máy in ảo. Chỉ hiểu đúng những lệnh app phát ra (`ESC @`, `GS v 0`, `GS V`, `ESC d`); byte khác là lỗi chứ
 * không bỏ qua — máy ảo dễ tính thì ảnh xanh ở nhà, giấy hỏng ở quán. Khổ 576 cố định: khối lệch khổ cũng ném.
 */
export function decodeJob(bytes: Uint8Array): DecodedJob {
  const stride = bytesPerRow(DOTS_PER_LINE)
  const commands: string[] = []
  const bands: Uint8Array[] = []
  let height = 0
  let p = 0

  const at = (i: number) => bytes[i] ?? 0
  const need = (n: number, what: string) => {
    if (p + n > bytes.length) {
      throw new Error(`Thiếu byte cho ${what} tại vị trí ${p}: cần ${n}, còn ${bytes.length - p}`)
    }
  }

  while (p < bytes.length) {
    const b = at(p)
    if (b === ESC) {
      need(2, 'ESC')
      const fn = at(p + 1)
      if (fn === 0x40) {
        commands.push('ESC @')
        p += 2
        continue
      }
      if (fn === 0x64) {
        need(3, 'ESC d')
        commands.push(`ESC d ${at(p + 2)}`)
        p += 3
        continue
      }
      throw new Error(`Byte lạ ${hex(fn)} sau ESC tại vị trí ${p + 1}`)
    }
    if (b === GS) {
      need(2, 'GS')
      const fn = at(p + 1)
      if (fn === 0x76) {
        need(8, 'GS v 0')
        const m = at(p + 3)
        if (at(p + 2) !== 0x30 || m !== 0) {
          throw new Error(`GS v ${hex(at(p + 2))} m=${m} tại vị trí ${p}: chỉ hiểu GS v 0 với m=0`)
        }
        const xBytes = at(p + 4) | (at(p + 5) << 8)
        const rows = at(p + 6) | (at(p + 7) << 8)
        if (xBytes !== stride) {
          throw new Error(`Khối GS v 0 rộng ${xBytes * 8} chấm tại vị trí ${p}, máy in ảo chỉ nhận ${DOTS_PER_LINE}`)
        }
        p += 8
        need(xBytes * rows, `dữ liệu khối ${xBytes}×${rows}`)
        bands.push(bytes.subarray(p, p + xBytes * rows))
        height += rows
        p += xBytes * rows
        commands.push(`GS v 0 ${xBytes}x${rows}`)
        continue
      }
      if (fn === 0x56) {
        need(3, 'GS V')
        const m = at(p + 2)
        if (m === 0 || m === 1 || m === 48 || m === 49) {
          commands.push(`GS V ${m}`)
          p += 3
          continue
        }
        if (m === 65 || m === 66) {
          need(4, 'GS V m n')
          commands.push(`GS V ${m} ${at(p + 3)}`)
          p += 4
          continue
        }
        throw new Error(`GS V ${m} tại vị trí ${p}: chế độ cắt không hiểu`)
      }
      throw new Error(`Byte lạ ${hex(fn)} sau GS tại vị trí ${p + 1}`)
    }
    throw new Error(`Byte lạ ${hex(b)} tại vị trí ${p}`)
  }

  const data = new Uint8Array(stride * height)
  let offset = 0
  for (const band of bands) {
    data.set(band, offset)
    offset += band.length
  }
  return { bitmap: { width: DOTS_PER_LINE, height, data }, commands }
}
