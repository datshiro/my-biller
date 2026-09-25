import { describe, expect, it } from 'vitest'
import { DOTS_PER_LINE } from '../escpos/bitmap'
import { JobFramer } from '../escpos/job-framer'
import { CELL_DOTS, composeBitmap, layoutBlocks, type TextRow } from '../escpos/reflow'
import { LINE_DOTS, parseJob, scanStream, type Block } from '../escpos/stream'

const enc = new TextEncoder()
const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...enc.encode(part)] : part)))

const ESC = 0x1b
const GS = 0x1d
const CUT = [GS, 0x56, 66, 3]

describe('parseJob', () => {
  it('chữ UTF-8 tiếng Việt, xuống dòng, kiểu chữ và căn lề thành các khối dòng', () => {
    const blocks = parseJob(
      bytes([ESC, 0x40], [ESC, 0x61, 1], [ESC, 0x45, 1], 'Quán Ăn Ngon', [ESC, 0x45, 0], '\n', [ESC, 0x61, 0], 'Phở bò  45.000đ\n', CUT),
    )
    expect(blocks).toEqual([
      {
        kind: 'line',
        align: 'center',
        runs: [{ text: 'Quán Ăn Ngon', style: { bold: true, underline: false, widthMul: 1, heightMul: 1 } }],
      },
      {
        kind: 'line',
        align: 'left',
        runs: [{ text: 'Phở bò  45.000đ', style: { bold: false, underline: false, widthMul: 1, heightMul: 1 } }],
      },
    ])
  })

  it('GS ! và ESC ! đổi cỡ chữ; ESC @ trả về mặc định', () => {
    const [big, plain] = parseJob(bytes([GS, 0x21, 0x11], 'TỔNG\n', [ESC, 0x40], 'x\n'))
    expect(big).toMatchObject({ runs: [{ style: { widthMul: 2, heightMul: 2 } }] })
    expect(plain).toMatchObject({ runs: [{ style: { widthMul: 1, heightMul: 1, bold: false } }] })
    const [mode] = parseJob(bytes([ESC, 0x21, 0x38], 'A\n'))
    expect(mode).toMatchObject({ runs: [{ style: { bold: true, widthMul: 2, heightMul: 2 } }] })
  })

  it('dòng trống và ESC d thành khoảng trắng; đẩy giấy cuối job bị bỏ', () => {
    expect(parseJob(bytes('a\n\n', [ESC, 0x64, 2], 'b\n', [ESC, 0x64, 4], CUT))).toEqual([
      expect.objectContaining({ kind: 'line' }),
      { kind: 'feed', dots: LINE_DOTS },
      { kind: 'feed', dots: 2 * LINE_DOTS },
      expect.objectContaining({ kind: 'line' }),
    ])
  })

  it('job chỉ có ESC @ và xuống dòng là rỗng', () => {
    expect(parseJob(bytes([ESC, 0x40], '\n\n', CUT))).toEqual([])
  })

  it('ảnh GS v 0 hẹp hơn khổ được giữ nguyên bit', () => {
    const [block] = parseJob(bytes([GS, 0x76, 0x30, 0, 2, 0, 1, 0, 0xff, 0x0f]))
    expect(block).toEqual({ kind: 'raster', align: 'left', bitmap: { width: 16, height: 1, data: Uint8Array.of(0xff, 0x0f) } })
  })

  it('két tiền, còi, hỏi trạng thái được bỏ qua; ESC i / ESC m là lệnh cắt', () => {
    expect(parseJob(bytes([0x10, 0x04, 1], [ESC, 0x70, 0, 25, 250], [ESC, 0x42, 2, 3], 'a\n', [ESC, 0x69]))).toHaveLength(1)
    const framer = new JobFramer()
    expect(framer.push(bytes('a\n', [ESC, 0x6d], 'b\n', [ESC, 0x69]))).toHaveLength(2)
  })

  it('chữ không phải UTF-8 là lỗi rõ ràng, không in ra dấu hỏi', () => {
    expect(() => parseJob(bytes([0x50, 0xe0, 0x0a]))).toThrow('không phải UTF-8')
  })

  it('lệnh bảng mã / chữ Hán / CR được bỏ qua', () => {
    expect(parseJob(bytes([ESC, 0x74, 16], [0x1c, 0x2e], 'a\r\n'))).toEqual([
      expect.objectContaining({ runs: [expect.objectContaining({ text: 'a' })] }),
    ])
  })

  it('lệnh lạ ném lỗi có vị trí thay vì in rác', () => {
    expect(() => parseJob(bytes('ab', [ESC, 0x5a, 1]))).toThrow('Lệnh chưa hỗ trợ ESC 0x5A tại vị trí 2')
    expect(() => parseJob(bytes([0x11, 1]))).toThrow('Byte điều khiển lạ 0x11 tại vị trí 0')
  })

  it('ảnh rộng hơn khổ giấy bị từ chối', () => {
    expect(() => parseJob(bytes([GS, 0x76, 0x30, 0, 80, 0, 1, 0]))).toThrow('rộng 640 chấm')
  })

  it('job cụt giữa lệnh ảnh là lỗi', () => {
    expect(() => parseJob(bytes('a', [GS, 0x76, 0x30, 0, 2, 0, 2, 0, 1, 2]))).toThrow('dừng giữa chừng')
  })
})

describe('scanStream', () => {
  it('lệnh còn dở ở cuối không phải lỗi: dừng và trả consumed', () => {
    expect(scanStream(bytes('ab', [GS, 0x76, 0x30])).consumed).toBe(2)
  })
})

describe('layoutBlocks', () => {
  const line = (text: string, align: 'left' | 'center' | 'right' = 'left', widthMul = 1): Block => ({
    kind: 'line',
    align,
    runs: [{ text, style: { bold: false, underline: false, widthMul, heightMul: 1 } }],
  })

  it('mỗi ký tự một ô 12 chấm, 48 cột thì xuống hàng', () => {
    const laid = layoutBlocks([line('x'.repeat(50))])
    expect(laid).toHaveLength(2)
    const [first, second] = laid.map((b) => (b as { row: TextRow }).row)
    expect(first?.glyphs).toHaveLength(48)
    expect(first?.glyphs[47]?.x).toBe(47 * CELL_DOTS)
    expect(second?.glyphs).toHaveLength(2)
  })

  it('căn giữa và căn phải theo bề rộng thật của hàng', () => {
    const center = layoutBlocks([line('ab', 'center')])[0] as { row: TextRow }
    expect(center.row.glyphs[0]?.x).toBe((DOTS_PER_LINE - 24) / 2)
    const right = layoutBlocks([line('ab', 'right', 2)])[0] as { row: TextRow }
    expect(right.row.glyphs[1]?.x).toBe(DOTS_PER_LINE - 24)
  })

  it('dấu tiếng Việt dạng rời được gộp vào một ô', () => {
    const laid = layoutBlocks([line('Phở'.normalize('NFD'))])[0] as { row: TextRow }
    expect(laid.row.glyphs.map((g) => g.ch)).toEqual(['P', 'h', 'ở'])
  })

  it('ảnh hẹp được đệm ra 576 và căn giữa theo byte', () => {
    const [img] = layoutBlocks([{ kind: 'raster', align: 'center', bitmap: { width: 16, height: 1, data: Uint8Array.of(0xff, 0xff) } }])
    expect(img).toMatchObject({ kind: 'image', bitmap: { width: 576, height: 1 } })
    const data = (img as { bitmap: { data: Uint8Array } }).bitmap.data
    expect(data[35]).toBe(0xff)
    expect(data[36]).toBe(0xff)
    expect(data[34]).toBe(0)
  })
})

describe('composeBitmap', () => {
  it('ghép hàng chữ, khoảng trắng, ảnh thành một bitmap 576', () => {
    const laid = layoutBlocks(parseJob(bytes('a\n\n', [GS, 0x76, 0x30, 0, 72, 0, 1, 0], new Array(72).fill(0xff))))
    const bitmap = composeBitmap(laid, (row) => ({ width: 576, height: row.height, data: new Uint8Array(72 * row.height).fill(1) }))
    expect(bitmap.width).toBe(576)
    expect(bitmap.height).toBe(LINE_DOTS + LINE_DOTS + 1)
    expect(bitmap.data[0]).toBe(1)
    expect(bitmap.data[72 * LINE_DOTS]).toBe(0)
    expect(bitmap.data[72 * 2 * LINE_DOTS]).toBe(0xff)
  })

  it('bộ vẽ trả sai cỡ thì ném', () => {
    const laid = layoutBlocks(parseJob(bytes('a\n')))
    expect(() => composeBitmap(laid, () => ({ width: 576, height: 1, data: new Uint8Array(72) }))).toThrow('cần 576×30')
  })
})

describe('JobFramer', () => {
  it('cắt job ngay sau lệnh cắt giấy, hai job trên cùng một nối', () => {
    const framer = new JobFramer()
    const jobs = framer.push(bytes('one\n', CUT, 'two\n', CUT, 'thr'))
    expect(jobs.map((j) => parseJob(j))).toEqual([
      [expect.objectContaining({ runs: [expect.objectContaining({ text: 'one' })] })],
      [expect.objectContaining({ runs: [expect.objectContaining({ text: 'two' })] })],
    ])
    expect(new TextDecoder().decode(framer.flush()!)).toBe('thr')
    expect(framer.flush()).toBeNull()
  })

  it('lệnh cắt bị chia đôi giữa hai khúc vẫn nhận ra', () => {
    const framer = new JobFramer()
    expect(framer.push(bytes('a\n', [GS, 0x56]))).toEqual([])
    expect(framer.push(bytes([66, 3]))).toHaveLength(1)
  })

  it('byte GS V nằm trong dữ liệu ảnh không cắt job', () => {
    const framer = new JobFramer()
    expect(framer.push(bytes([GS, 0x76, 0x30, 0, 4, 0, 1, 0, GS, 0x56, 66, 3]))).toEqual([])
    expect(framer.flush()).toHaveLength(12)
  })

  it('job cắt xong trước lệnh lạ vẫn ra, dù cùng một khúc đọc hay chia hai khúc', () => {
    const stream = bytes('one\n', CUT, 'one\n', CUT, [ESC, 0x5a, 1])
    const whole = new JobFramer()
    expect(whole.push(stream)).toHaveLength(2)
    const split = new JobFramer()
    expect([...split.push(stream.subarray(0, 10)), ...split.push(stream.subarray(10))]).toHaveLength(2)
    expect(() => parseJob(whole.flush()!)).toThrow('ESC 0x5A')
  })

  it('đang dở một lệnh thì midCommand bật, đủ byte thì tắt', () => {
    const framer = new JobFramer()
    framer.push(bytes('a', [GS, 0x76, 0x30, 0, 1, 0, 2, 0, 1]))
    expect(framer.midCommand).toBe(true)
    framer.push(bytes([2]))
    expect(framer.midCommand).toBe(false)
  })

  it('gặp lệnh lạ thì gom tới flush, parseJob báo lại lỗi', () => {
    const framer = new JobFramer()
    expect(framer.push(bytes('a', [ESC, 0x5a, 1], 'b\n', CUT))).toEqual([])
    const rest = framer.flush()!
    expect(() => parseJob(rest)).toThrow('ESC 0x5A')
    expect(framer.push(bytes('ok\n', CUT))).toHaveLength(1)
  })
})
