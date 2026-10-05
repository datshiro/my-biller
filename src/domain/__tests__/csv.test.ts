import { describe, expect, it } from 'vitest'
import { CsvFileError, decodeCsvBytes, MAX_CSV_BYTES, parseCsv } from '../csv'

function utf8(text: string, withBom = false): Uint8Array {
  const bytes = new TextEncoder().encode(text)
  if (!withBom) return bytes
  return new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])
}

describe('decodeCsvBytes', () => {
  it('đọc đúng bytes UTF-8 hợp lệ', () => {
    expect(decodeCsvBytes(utf8('Nhóm,Tên món\nĐồ uống,Trà đá'))).toBe('Nhóm,Tên món\nĐồ uống,Trà đá')
  })

  it('từ chối bytes Windows-1258 (không phải UTF-8) và nói cách lưu lại', () => {
    // "Phở" mã Windows-1258: byte 0xf4 không mở đầu chuỗi UTF-8 hợp lệ.
    const windows1258 = new Uint8Array([0x50, 0x68, 0xf4])
    expect(() => decodeCsvBytes(windows1258)).toThrow(CsvFileError)
    expect(() => decodeCsvBytes(windows1258)).toThrow(/CSV UTF-8/)
  })

  it('từ chối file quá lớn', () => {
    const big = new Uint8Array(MAX_CSV_BYTES + 1)
    expect(() => decodeCsvBytes(big)).toThrow(/File quá lớn/)
  })
})

describe('parseCsv', () => {
  it('bỏ BOM đầu file, đọc đúng tiêu đề', () => {
    const text = new TextDecoder('utf-8').decode(utf8('Nhóm,Tên món\nĐồ uống,Trà đá', true))
    const rows = parseCsv(text)
    expect(rows[0]!).toEqual({ line: 1, cells: ['Nhóm', 'Tên món'] })
  })

  it('chọn `;` khi tiêu đề có nhiều `;` hơn `,`', () => {
    const rows = parseCsv('Nhóm;Tên món;Đơn vị\nĐồ uống;Trà đá;Ly')
    expect(rows[0]!.cells).toEqual(['Nhóm', 'Tên món', 'Đơn vị'])
    expect(rows[1]!.cells).toEqual(['Đồ uống', 'Trà đá', 'Ly'])
  })

  it('chọn `,` khi tiêu đề có nhiều `,` hơn `;` (hoặc bằng nhau)', () => {
    const rows = parseCsv('Nhóm,Tên món,Đơn vị\nĐồ uống,Trà đá,Ly')
    expect(rows[0]!.cells).toEqual(['Nhóm', 'Tên món', 'Đơn vị'])
  })

  it('đếm dấu phân cách ngoài ngoặc kép, không tính dấu bên trong ô', () => {
    // Tiêu đề có 1 dấu `,` ngoài ngoặc nhưng 2 dấu `;` bên trong một ô có ngoặc kép — phải chọn `,`.
    const rows = parseCsv('"Ghi chú; có; chấm phẩy",Giá\n"A; B",1000')
    expect(rows[0]!.cells).toEqual(['Ghi chú; có; chấm phẩy', 'Giá'])
  })

  it('ô có ngoặc kép chứa dấu phẩy, chấm phẩy, xuống dòng, và `""` ra một `"`', () => {
    const rows = parseCsv('Tên,Ghi chú\n"Trà, đá","Ngon ""lắm""\nạ"')
    expect(rows[1]!.cells).toEqual(['Trà, đá', 'Ngon "lắm"\nạ'])
  })

  it('CRLF, LF, CR đơn đều là hết hàng; CRLF không để lại \\r cuối ô', () => {
    const crlf = parseCsv('A,B\r\nC,D')
    expect(crlf[1]!.cells).toEqual(['C', 'D'])
    const lf = parseCsv('A,B\nC,D')
    expect(lf[1]!.cells).toEqual(['C', 'D'])
    const cr = parseCsv('A,B\rC,D')
    expect(cr[1]!.cells).toEqual(['C', 'D'])
  })

  it('ô xuống dòng trong ngoặc kép không tăng line của hàng sau', () => {
    const rows = parseCsv('Tên,Ghi chú\n"Trà đá","Dòng 1\nDòng 2"\nCà phê,Đậm')
    expect(rows[1]!).toEqual({ line: 2, cells: ['Trà đá', 'Dòng 1\nDòng 2'] })
    expect(rows[2]!).toEqual({ line: 3, cells: ['Cà phê', 'Đậm'] })
  })

  it('hàng trống ở giữa vẫn chiếm một số dòng, trả về cells rỗng', () => {
    const rows = parseCsv('Tên,Giá\nA,1\n\nB,2')
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 4])
    expect(rows[2]!).toEqual({ line: 3, cells: [''] })
  })

  it('hàng trống cuối file không sinh bản ghi thừa', () => {
    const rows = parseCsv('Tên,Giá\nA,1\n')
    expect(rows).toHaveLength(2)
  })

  it('ngoặc kép không đóng tới hết file báo đúng số dòng', () => {
    expect(() => parseCsv('Tên,Giá\nA,"chưa đóng')).toThrow(/dòng 2.*ngoặc kép chưa đóng/)
  })

  it('không chậm bậc hai với file nhiều hàng (chỉ đo, không chặn CI)', () => {
    const header = 'Nhóm,Tên,Đơn vị,Giá bán,Giá vốn,Ghi chú\n'
    const row = 'Đồ uống,Trà đá,Ly,10000,5000,""\n'
    const text = header + row.repeat(500)
    const start = performance.now()
    const rows = parseCsv(text)
    const elapsed = performance.now() - start
    expect(rows.length).toBe(501)
    expect(elapsed).toBeLessThan(1000)
  })
})
