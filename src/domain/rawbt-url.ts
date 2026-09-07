import { toBase64 } from './base64.ts'

export const RAWBT_URL_MAX_CHARS = 220_000
export const RAWBT_PLAY_URL = 'https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter'

export type RawbtPayload =
  | { kind: 'png'; bytes: Uint8Array }
  | { kind: 'escpos'; bytes: Uint8Array }

/**
 * Dựng URL scheme `rawbt:` cho RawBT. PNG đi qua `data:image/png;base64,` để RawBT tự dither/cắt; byte
 * ESC/POS thô đi qua `base64,` (lối lùi in 1:1, giữ `GS V`). Không `import.meta.env` — file này được e2e
 * và script Node import thẳng.
 */
export function rawbtUrl(payload: RawbtPayload): string {
  const b64 = toBase64(payload.bytes)
  return payload.kind === 'png' ? `rawbt:data:image/png;base64,${b64}` : `rawbt:base64,${b64}`
}

/**
 * Ước cỡ parcel Binder khi Android truyền URL cho RawBT: chuỗi qua Parcel là UTF-16 nên ~2 byte/ký tự.
 * KHÔNG dùng trong guard runtime — guard so `url.length` với `RAWBT_URL_MAX_CHARS` (cùng đơn vị ký tự với
 * e2e). Hàm này là bằng chứng chạy được trong ca test cho câu "vì sao hạn ký tự đó an toàn": URL dài đúng
 * bằng hạn ký tự, quy ra byte parcel, vẫn dưới mốc cảnh báo Binder 500.000.
 */
export function uocLuongParcel(url: string): number {
  return url.length * 2
}
