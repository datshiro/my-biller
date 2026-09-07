import { concatBitmaps } from '@/domain/escpos/bitmap'
import { encodePng1 } from '@/domain/escpos/png-1bit'
import { sampleBitmap } from '@/domain/escpos/sample'
import { toBitmap } from '@/domain/escpos/threshold'
import { RAWBT_URL_MAX_CHARS, rawbtUrl } from '@/domain/rawbt-url'
import { captureThermal } from './thermal-capture'

/**
 * Phiếu → href `rawbt:` PNG 1-bit dựng sẵn cho `<a>` (chạm mở RawBT). Trả `null` nếu URL vượt
 * `RAWBT_URL_MAX_CHARS` — nút không render, người bán dùng 📤 CHIA SẺ. Cùng `Bitmap` với `buildReceiptJob`.
 */
export async function buildReceiptRawbtHref(node: HTMLElement): Promise<string | null> {
  const bitmap = toBitmap(await captureThermal(node))
  const url = rawbtUrl({ kind: 'png', bytes: await encodePng1(bitmap) })
  return url.length > RAWBT_URL_MAX_CHARS ? null : url
}

/** Tờ IN THỬ qua RawBT (D14): cùng bitmap với `buildSampleJob` — phần chữ ghép trên thước `sampleBitmap()`. */
export async function buildSampleRawbtHref(sheet: HTMLElement): Promise<string> {
  const bitmap = concatBitmaps(toBitmap(await captureThermal(sheet)), sampleBitmap())
  return rawbtUrl({ kind: 'png', bytes: await encodePng1(bitmap) })
}
