import { describe, expect, it } from 'vitest'
import { buildOrderCode, nextSeqOfDay, orderCodeDatePart, parseOrderCode } from '../order-code'

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('buildOrderCode', () => {
  it('sinh mã PBH-YYMMDD-NNN', () => {
    expect(buildOrderCode(at(2026, 8, 7), 1)).toBe('PBH-260807-001')
    expect(buildOrderCode(at(2026, 8, 7), 42)).toBe('PBH-260807-042')
  })

  it('không cắt số khi quá 999 đơn/ngày', () => {
    expect(buildOrderCode(at(2026, 8, 7), 1_000)).toBe('PBH-260807-1000')
  })

  it('từ chối số thứ tự không hợp lệ', () => {
    expect(() => buildOrderCode(at(2026, 8, 7), 0)).toThrow()
    expect(() => buildOrderCode(at(2026, 8, 7), 1.5)).toThrow()
  })

  it('dùng giờ máy: đơn lúc 23h50 vẫn thuộc ngày hôm đó', () => {
    expect(orderCodeDatePart(at(2026, 8, 7, 23, 50))).toBe('260807')
    expect(orderCodeDatePart(at(2026, 8, 8, 0, 10))).toBe('260808')
  })
})

describe('nextSeqOfDay', () => {
  const soldAt = at(2026, 8, 7)

  it('ngày chưa có đơn thì bắt đầu từ 1', () => {
    expect(nextSeqOfDay([], soldAt)).toBe(1)
  })

  it('lấy số lớn nhất trong ngày + 1, bỏ qua mã của ngày khác', () => {
    const codes = ['PBH-260806-009', 'PBH-260807-001', 'PBH-260807-007', 'PBH-260808-003']
    expect(nextSeqOfDay(codes, soldAt)).toBe(8)
  })

  it('bỏ qua mã rác không đúng định dạng', () => {
    expect(nextSeqOfDay(['rác', '', 'PBH-260807-002'], soldAt)).toBe(3)
  })

  it('sang ngày mới thì đánh số lại từ 1', () => {
    expect(nextSeqOfDay(['PBH-260807-300'], at(2026, 8, 8))).toBe(1)
  })
})

describe('parseOrderCode', () => {
  it('đọc ngược được mã hợp lệ, trả null với mã sai', () => {
    expect(parseOrderCode('PBH-260807-042')).toEqual({ datePart: '260807', seq: 42 })
    expect(parseOrderCode('HD-260807-042')).toBeNull()
  })
})
