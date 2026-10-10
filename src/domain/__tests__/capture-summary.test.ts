import { describe, expect, it } from 'vitest'
import { toBase64 } from '../base64'
import { formatSummary, parseSnifferLine, summarizeCapture } from '../escpos/capture-summary'

const enc = new TextEncoder()
const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...enc.encode(part)] : part)))

const ESC = 0x1b
const GS = 0x1d
const CUT = [GS, 0x56, 66, 3]

describe('summarizeCapture', () => {
  it('đọc chữ UTF-8 theo dòng, bỏ dòng trắng và nhận ra các lệnh', () => {
    const summary = summarizeCapture(
      bytes([ESC, 0x40], [ESC, 0x61, 1], 'GF-085\n', '\n', 'Cơm tấm sườn x2   90.000\n', CUT),
    )

    expect(summary.lines).toEqual(['GF-085', 'Cơm tấm sườn x2   90.000'])
    expect(summary.notUtf8).toBe(false)
    expect(summary.commands).toEqual(['ESC @', 'ESC a', 'cắt giấy'])
    expect(summary.stoppedAt).toBeUndefined()
  })

  it('báo kích thước ảnh raster GS v 0', () => {
    const width = 16
    const height = 3
    const raster = [GS, 0x76, 0x30, 0, width / 8, 0, height, 0, ...new Array((width / 8) * height).fill(0xff)]

    const summary = summarizeCapture(bytes([ESC, 0x40], raster, CUT))

    expect(summary.rasters).toEqual([{ width, height }])
    expect(summary.lines).toEqual([])
    expect(summary.commands).toContain('GS v 0')
  })

  it('chữ không phải UTF-8 vẫn đọc được và được đánh dấu', () => {
    const summary = summarizeCapture(bytes([0x43, 0xf3, 0x6d, 0x0a]))

    expect(summary.notUtf8).toBe(true)
    expect(summary.lines).toHaveLength(1)
  })

  it('lệnh lạ: giữ phần đã đọc và chỉ ra byte tại chỗ dừng', () => {
    const summary = summarizeCapture(bytes('A\n', [ESC, 0x99, 1, 2, 3]))

    expect(summary.lines).toEqual(['A'])
    expect(summary.stoppedAt?.offset).toBe(2)
    expect(summary.stoppedAt?.problem).toBeTruthy()
    expect(summary.stoppedAt?.rest.startsWith('1b 99')).toBe(true)
  })

  it('job dừng giữa lệnh: báo dừng, không có lỗi lệnh lạ', () => {
    const summary = summarizeCapture(bytes('A\n', [GS, 0x76]))

    expect(summary.stoppedAt?.problem).toBeUndefined()
    expect(summary.stoppedAt?.offset).toBe(2)
  })

  it('dữ liệu rỗng không ném lỗi', () => {
    const summary = summarizeCapture(new Uint8Array())

    expect(summary).toMatchObject({ bytes: 0, lines: [], rasters: [], commands: [] })
    expect(formatSummary(summary)).toContain('  (không có chữ hay ảnh đọc được)')
  })
})

describe('formatSummary', () => {
  it('in ảnh trước chữ rồi tới lệnh', () => {
    const out = formatSummary({
      bytes: 10,
      lines: ['GF-085'],
      notUtf8: false,
      rasters: [{ width: 576, height: 1180 }],
      commands: ['ESC @'],
    })

    expect(out).toEqual(["  ảnh : raster 576×1180", "  chữ : 'GF-085'", '  lệnh: ESC @'])
  })

  it('cắt bớt khi quá nhiều dòng chữ', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `d${i}`)

    const [text] = formatSummary({ bytes: 1, lines, notUtf8: false, rasters: [], commands: [] })

    expect(text).toContain('(+3 dòng)')
  })
})

describe('parseSnifferLine', () => {
  it('nhận các sự kiện kết nối', () => {
    expect(parseSnifferLine('CONN AA:BB:CC:DD:EE:FF')).toEqual({ kind: 'conn', device: 'AA:BB:CC:DD:EE:FF' })
    expect(parseSnifferLine('MTU 185\r')).toEqual({ kind: 'mtu', mtu: 185 })
    expect(parseSnifferLine('SUB 18f0/2af0')).toEqual({ kind: 'sub', char: '18f0/2af0' })
    expect(parseSnifferLine('DISC')).toEqual({ kind: 'disc' })
  })

  it('giải base64 của DATA về đúng byte', () => {
    const payload = bytes([ESC, 0x40], 'Cơm\n')

    const event = parseSnifferLine(`DATA 18f0/2af1 ${toBase64(payload)}`)

    expect(event).toEqual({ kind: 'data', char: '18f0/2af1', bytes: payload })
  })

  it('log khởi động và dòng hỏng là other, không ném lỗi', () => {
    expect(parseSnifferLine('ets Jun  8 2016 00:22:57')).toEqual({ kind: 'other', line: 'ets Jun  8 2016 00:22:57' })
    expect(parseSnifferLine('DATA onlychar')).toMatchObject({ kind: 'other' })
    expect(parseSnifferLine('DATA c not*base64')).toMatchObject({ kind: 'other' })
    expect(parseSnifferLine('MTU abc')).toMatchObject({ kind: 'other' })
  })
})
