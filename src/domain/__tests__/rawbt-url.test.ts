import { describe, expect, it } from 'vitest'
import { RAWBT_PLAY_URL, RAWBT_URL_MAX_CHARS, rawbtUrl, uocLuongParcel } from '../rawbt-url.ts'

describe('rawbt-url', () => {
  it('PNG → tiền tố rawbt:data:image/png;base64,', () => {
    const url = rawbtUrl({ kind: 'png', bytes: new Uint8Array([0, 1, 2]) })
    expect(url.startsWith('rawbt:data:image/png;base64,')).toBe(true)
  })

  it('ESC/POS → tiền tố rawbt:base64, (không data:)', () => {
    const url = rawbtUrl({ kind: 'escpos', bytes: new Uint8Array([0x1b, 0x40]) })
    expect(url.startsWith('rawbt:base64,')).toBe(true)
    expect(url.startsWith('rawbt:data:')).toBe(false)
  })

  it('URL đầy tới hạn ký tự của guard vẫn dưới mốc Binder 500.000 byte (ước ×2 UTF-16)', () => {
    // Bằng chứng cho câu "hạn RAWBT_URL_MAX_CHARS an toàn": một URL dài đúng bằng hạn (guard char-based),
    // quy ra byte parcel qua uocLuongParcel, vẫn dưới mốc cảnh báo Binder 500.000.
    expect(uocLuongParcel('x'.repeat(RAWBT_URL_MAX_CHARS))).toBeLessThan(500_000)
  })

  it('link Play trỏ đúng package RawBT', () => {
    expect(RAWBT_PLAY_URL).toContain('ru.a402d.rawbtprinter')
  })
})
