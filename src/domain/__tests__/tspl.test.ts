import { describe, expect, it } from 'vitest'
import { bytesPerRow } from '../escpos/bitmap'
import { encodeLabels, labelDots } from '../tspl/encode'

const size = { widthMm: 40, heightMm: 30, gapMm: 2 }
const blank = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8Array(bytesPerRow(width) * height),
})
const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')

describe('encodeLabels', () => {
  it('203 dpi: tem 40×30 mm là 320×240 chấm', () => {
    expect(labelDots(size)).toEqual({ width: 320, height: 240 })
  })

  it('khai khổ và khe hở một lần, rồi đúng n khối CLS…PRINT cho n tem', () => {
    const job = latin1(encodeLabels(blank(320, 240), size, 4))

    expect(job.startsWith('SIZE 40 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\n')).toBe(true)
    expect(job.match(/\r\nPRINT 1,1\r\n/g)).toHaveLength(4)
    expect(job.match(/CLS\r\nBITMAP 0,0,40,240,0,/g)).toHaveLength(4)
  })

  it('mỗi tem mang số thứ tự riêng i/n, canh sát góc dưới phải', () => {
    const job = latin1(encodeLabels(blank(320, 240), size, 3))

    // "1/3" rộng 3×24 = 72 chấm → x = 320 − 72 − 8; y = 240 − 32 − 8.
    expect(job).toContain('TEXT 240,200,"4",0,1,1,"1/3"')
    expect(job).toContain('TEXT 240,200,"4",0,1,1,"2/3"')
    expect(job).toContain('TEXT 240,200,"4",0,1,1,"3/3"')
    expect(job).not.toContain('"4/3"')
  })

  it('tem hẹp mà số thứ tự dài → kẹp x về 0, không vẽ ra ngoài mép trái', () => {
    const narrow = { widthMm: 20, heightMm: 30, gapMm: 2 }
    const job = latin1(encodeLabels(blank(160, 240), narrow, 100))
    expect(job).toContain('TEXT 0,200,"4",0,1,1,"100/100"')
  })

  it('đảo bit: TSPL coi 0 là chấm đen, ngược ESC/POS', () => {
    const bitmap = blank(320, 240)
    bitmap.data[0] = 0b1000_0000
    const job = encodeLabels(bitmap, size, 1)
    const head = latin1(job).indexOf('BITMAP 0,0,40,240,0,') + 'BITMAP 0,0,40,240,0,'.length

    expect(job[head]).toBe(0b0111_1111)
    expect(job[head + 1]).toBe(0xff)
  })

  it('ảnh lệch khổ hoặc số tem không hợp lệ → ném, không co giãn cho vừa', () => {
    expect(() => encodeLabels(blank(576, 240), size, 1)).toThrow(/cần 320×240/)
    expect(() => encodeLabels(blank(320, 240), size, 0)).toThrow(/nguyên dương/)
    expect(() => encodeLabels(blank(320, 240), size, 1.5)).toThrow(/nguyên dương/)
  })
})
