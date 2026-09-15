import { concatBitmaps } from '@/domain/escpos/bitmap'
import { encodeJob } from '@/domain/escpos/encode'
import { sampleBitmap } from '@/domain/escpos/sample'
import { toBitmap } from '@/domain/escpos/threshold'
import { captureThermal } from './thermal-capture'

/** Phiếu bán hàng → luồng byte ESC/POS raster (chụp → nhị phân hoá → mã hoá). */
export async function buildReceiptJob(node: HTMLElement): Promise<Uint8Array> {
  return encodeJob(toBitmap(await captureThermal(node)))
}

/** Tờ IN THỬ (D14): phần chữ chụp từ `<SampleSheet>` ghép trên thước `sampleBitmap()` thuần. */
export async function buildSampleJob(sheet: HTMLElement): Promise<Uint8Array> {
  return encodeJob(concatBitmaps(toBitmap(await captureThermal(sheet)), sampleBitmap()))
}
