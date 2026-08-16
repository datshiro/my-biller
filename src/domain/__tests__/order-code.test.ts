import { describe, expect, it } from 'vitest'
import { buildOrderCode, nextSeqOfDay, orderCodeDatePart, parseOrderCode } from '../order-code'

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('buildOrderCode', () => {
  it('sinh mã PBH-YYMMDD-LNNN', () => {
    expect(buildOrderCode(at(2026, 8, 7), 1, 'A')).toBe('PBH-260807-A001')
    expect(buildOrderCode(at(2026, 8, 7), 42, 'b')).toBe('PBH-260807-B042')
  })

  it('không cắt số khi quá 999 đơn/ngày', () => {
    expect(buildOrderCode(at(2026, 8, 7), 1_000, 'A')).toBe('PBH-260807-A1000')
  })

  it('từ chối số thứ tự không hợp lệ', () => {
    expect(() => buildOrderCode(at(2026, 8, 7), 0, 'A')).toThrow()
    expect(() => buildOrderCode(at(2026, 8, 7), 1.5, 'A')).toThrow()
    expect(() => buildOrderCode(at(2026, 8, 7), 1, 'AA')).toThrow()
  })

  it('dùng giờ máy: đơn lúc 23h50 vẫn thuộc ngày hôm đó', () => {
    expect(orderCodeDatePart(at(2026, 8, 7, 23, 50))).toBe('260807')
    expect(orderCodeDatePart(at(2026, 8, 8, 0, 10))).toBe('260808')
  })
})

describe('nextSeqOfDay', () => {
  const soldAt = at(2026, 8, 7)

  it('ngày chưa có đơn thì bắt đầu từ 1', () => {
    expect(nextSeqOfDay([], soldAt, 'A')).toBe(1)
  })

  it('lấy số lớn nhất trong ngày + 1, bỏ qua mã của ngày khác', () => {
    const codes = ['PBH-260806-A009', 'PBH-260807-A001', 'PBH-260807-A007', 'PBH-260808-A003']
    expect(nextSeqOfDay(codes, soldAt, 'A')).toBe(8)
  })

  it('bỏ qua mã rác không đúng định dạng', () => {
    expect(nextSeqOfDay(['rác', '', 'PBH-260807-A002'], soldAt, 'A')).toBe(3)
  })

  it('sang ngày mới thì đánh số lại từ 1', () => {
    expect(nextSeqOfDay(['PBH-260807-A300'], at(2026, 8, 8), 'A')).toBe(1)
  })

  it('mỗi chữ cái có dãy riêng và bỏ qua mã cũ', () => {
    const codes = ['PBH-260807-099', 'PBH-260807-A007', 'PBH-260807-B011']
    expect(nextSeqOfDay(codes, soldAt, 'A')).toBe(8)
    expect(nextSeqOfDay(codes, soldAt, 'B')).toBe(12)
  })
})

describe('parseOrderCode', () => {
  it('đọc ngược được mã hợp lệ, trả null với mã sai', () => {
    expect(parseOrderCode('PBH-260807-A042')).toEqual({ datePart: '260807', letter: 'A', seq: 42 })
    expect(parseOrderCode('PBH-260807-042')).toEqual({ datePart: '260807', letter: null, seq: 42 })
    expect(parseOrderCode('HD-260807-042')).toBeNull()
  })
})
