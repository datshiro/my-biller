import { describe, expect, it } from 'vitest'
import { decideBack, type BackAction } from '../back-button'
import { TAB_PATHS } from '../tabs'

const TAB_ROOTS = ['/', '/don', '/chi-phi', '/bao-cao', '/them']

describe('decideBack', () => {
  it('danh sách gốc tab lấy từ bottom nav, không chép tay', () => {
    expect(TAB_PATHS).toEqual(TAB_ROOTS)
  })

  it.each<[string, { pathname: string; historyIdx: number }, BackAction]>([
    ['chi tiết đơn có lịch sử thì quay lại', { pathname: '/don/12', historyIdx: 2 }, 'navigate-back'],
    ['phiếu có lịch sử thì quay lại', { pathname: '/don/12/phieu', historyIdx: 3 }, 'navigate-back'],
    ['trang sâu không có lịch sử thì về trang chủ', { pathname: '/them/sao-luu', historyIdx: 0 }, 'go-home'],
    ['route ngoài bottom nav có lịch sử thì quay lại', { pathname: '/cong-no', historyIdx: 1 }, 'navigate-back'],
    ['gốc tab ở đầu lịch sử thì thu nhỏ app', { pathname: '/', historyIdx: 0 }, 'minimize'],
    ['gốc tab có lịch sử cũng thu nhỏ app', { pathname: '/don', historyIdx: 5 }, 'minimize'],
    ['gạch cuối ở gốc tab vẫn là gốc tab', { pathname: '/don/', historyIdx: 5 }, 'minimize'],
    ['gạch cuối ở trang con vẫn quay lại được', { pathname: '/don/12/', historyIdx: 2 }, 'navigate-back'],
  ])('%s', (_name, input, expected) => {
    expect(decideBack(input)).toBe(expected)
  })

  it.each(TAB_ROOTS)('gốc tab %s với lịch sử 5 thì thu nhỏ app', (pathname) => {
    expect(decideBack({ pathname, historyIdx: 5 })).toBe('minimize')
  })
})
