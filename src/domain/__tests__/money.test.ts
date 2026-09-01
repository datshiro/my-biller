import { describe, expect, it } from 'vitest'
import {
  assertInt,
  assertMoney,
  formatAmount,
  formatQty,
  formatVnd,
  parseMoneyInput,
  parseQtyInput,
} from '../money'

describe('formatVnd', () => {
  it.each([
    [0, '0 đ'],
    [3_000, '3.000 đ'],
    [110_000, '110.000 đ'],
    [1_250_000, '1.250.000 đ'],
    [-45_000, '-45.000 đ'],
  ])('%i → %s', (input, expected) => {
    expect(formatVnd(input)).toBe(expected)
  })

  it('formatAmount bỏ đơn vị để dùng trong ô nhập', () => {
    expect(formatAmount(1_250_000)).toBe('1.250.000')
  })
})

describe('parseMoneyInput', () => {
  it.each([
    ['50000', 50_000],
    ['50.000', 50_000],
    ['50,000', 50_000],
    ['50 000', 50_000],
    [' 50k ', 50_000],
    ['50K', 50_000],
    ['1.250.000', 1_250_000],
    ['0', 0],
  ])('đọc được %s', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected)
  })

  it.each(['', '-5000', 'abc', '5 0 k đ', '1e5', '50kk'])('từ chối %s', (input) => {
    expect(parseMoneyInput(input)).toBeNull()
  })

  it.each(['50.5', '1.5k', '1.250,000', '1.25.000', '1,2500'])(
    'từ chối dấu phân nhóm sai chuẩn: %s',
    (input) => {
      // Thà bắt người dùng gõ lại còn hơn âm thầm hiểu "50.5" thành 505 đồng.
      expect(parseMoneyInput(input)).toBeNull()
    },
  )
})

describe('parseMoneyInput — số quá lớn', () => {
  it('từ chối khi nhân 1000 làm vượt ngưỡng số nguyên an toàn của JS', () => {
    expect(parseMoneyInput('9007199254741k')).toBeNull()
    expect(parseMoneyInput('9007199254740991')).toBe(9_007_199_254_740_991)
  })
})

describe('parseQtyInput', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['0,5', 0.5],
    ['0.5', 0.5],
    ['1,25', 1.25],
    // `0` là số ĐỌC ĐƯỢC, nghĩa là "bỏ món" — cùng ngữ nghĩa với nút `−` ở qty 1. `null` từ đây trở
    // đi chỉ còn đúng một nghĩa: không đọc được.
    ['0', 0],
    ['999999', 999_999],
  ])('đọc được %s', (input, expected) => {
    expect(parseQtyInput(input)).toBe(expected)
  })

  it.each([
    '-1',
    '',
    'x',
    // Ba chữ số sau dấu là hình dạng phân nhóm TIỀN (`money.ts:28`), không phân xử được với thập
    // phân. Từ chối chứ không đoán: chủ quán gõ "1.000" là định nói một nghìn, không phải một.
    '1.000',
    '2.500',
    '1,000',
    '1,2345',
    // RT-9: không có trần phần nguyên thì ~12 chữ số làm `assertMoney` ném ngay trong render của
    // SalesPage và ErrorBoundary nuốt màn Bán hàng giữa lúc bán.
    '1234567',
  ])('từ chối %s', (input) => {
    expect(parseQtyInput(input)).toBeNull()
  })

  it('hiển thị lại số lượng thập phân theo kiểu Việt', () => {
    expect(formatQty(0.5)).toBe('0,5')
    expect(formatQty(2)).toBe('2')
  })
})

describe('assertInt / assertMoney', () => {
  it('chặn float lọt xuống DB', () => {
    expect(() => assertInt(1_000.5)).toThrow(/số nguyên/)
    expect(() => assertMoney(-1)).toThrow(/không được âm/)
    expect(assertMoney(0)).toBe(0)
  })
})
