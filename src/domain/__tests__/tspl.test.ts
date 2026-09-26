import { describe, expect, it } from 'vitest'
import { bytesPerRow } from '../escpos/bitmap'
import { encodeLabels, labelDots } from '../tspl/encode'

const size = { widthMm: 40, heightMm: 30, gapMm: 2 }
const blank = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8Array(bytesPerRow(width) * height),
})
const repeat = <T,>(item: T, n: number) => Array.from({ length: n }, () => item)
const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('')
const HEAD = 'BITMAP 0,0,40,240,0,'

describe('encodeLabels', () => {
  it('203 dpi: tem 40×30 mm là 320×240 chấm', () => {
    expect(labelDots(size)).toEqual({ width: 320, height: 240 })
  })

  it('khai khổ và khe hở một lần, rồi đúng n khối CLS…PRINT cho n tem', () => {
    const job = latin1(encodeLabels(repeat(blank(320, 240), 4), size))

    expect(job.startsWith('SIZE 40 mm,30 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1,0\r\nREFERENCE 0,0\r\n')).toBe(true)
    expect(job.match(/\r\nPRINT 1,1\r\n/g)).toHaveLength(4)
    expect(job.match(/CLS\r\nBITMAP 0,0,40,240,0,/g)).toHaveLength(4)
  })

  it('mỗi tem mang ảnh CỦA NÓ theo đúng thứ tự: món A ×2 rồi món B ×1', () => {
    const a = blank(320, 240)
    a.data[0] = 0b1000_0000
    const b = blank(320, 240)
    b.data[0] = 0b0100_0000
    const job = encodeLabels([a, a, b], size)
    const text = latin1(job)
    const firstBytes: number[] = []
    for (let at = text.indexOf(HEAD); at !== -1; at = text.indexOf(HEAD, at + 1)) {
      firstBytes.push(job[at + HEAD.length] ?? -1)
    }

    expect(firstBytes).toEqual([0b0111_1111, 0b0111_1111, 0b1011_1111])
  })

  it('số thứ tự i/n chạy suốt cả đơn, canh sát góc dưới phải', () => {
    const job = latin1(encodeLabels(repeat(blank(320, 240), 3), size))

    // "1/3" rộng 3×24 = 72 chấm → x = 320 − 72 − 8; y = 240 − 32 − 8.
    expect(job).toContain('TEXT 240,200,"4",0,1,1,"1/3"')
    expect(job).toContain('TEXT 240,200,"4",0,1,1,"3/3"')
    expect(job).not.toContain('"4/3"')
  })

  it('tem cao từ 40 mm: số thứ tự phóng đôi, vẫn sát góc dưới phải', () => {
    const job = latin1(encodeLabels(repeat(blank(480, 320), 2), { widthMm: 60, heightMm: 40, gapMm: 2 }))
    // "1/2" rộng 3×48 = 144 → x = 480 − 144 − 8; cao 64 → y = 320 − 64 − 8.
    expect(job).toContain('TEXT 328,248,"4",0,2,2,"1/2"')
  })

  it('tem hẹp mà số thứ tự dài → kẹp x về 0, không vẽ ra ngoài mép trái', () => {
    const job = latin1(encodeLabels(repeat(blank(160, 240), 100), { widthMm: 20, heightMm: 30, gapMm: 2 }))
    expect(job).toContain('TEXT 0,200,"4",0,1,1,"100/100"')
  })

  it('đảo bit: TSPL coi 0 là chấm đen, ngược ESC/POS', () => {
    const bitmap = blank(320, 240)
    bitmap.data[0] = 0b1000_0000
    const job = encodeLabels([bitmap], size)
    const head = latin1(job).indexOf(HEAD) + HEAD.length

    expect(job[head]).toBe(0b0111_1111)
    expect(job[head + 1]).toBe(0xff)
  })

  it('ảnh lệch khổ hoặc không có tem nào → ném, không co giãn cho vừa', () => {
    expect(() => encodeLabels([blank(576, 240)], size)).toThrow(/cần 320×240/)
    expect(() => encodeLabels([], size)).toThrow(/Không có tem/)
  })
})
