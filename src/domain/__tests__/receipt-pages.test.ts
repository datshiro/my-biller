import { describe, expect, it } from 'vitest'
import { LINES_PER_PAGE, paginateLines } from '../receipt-pages'

const lines = (count: number) => Array.from({ length: count }, (_, index) => index + 1)

describe('paginateLines', () => {
  it('phiếu ngắn nằm gọn một trang', () => {
    expect(paginateLines(lines(3))).toEqual([[1, 2, 3]])
  })

  it('đúng bằng giới hạn thì vẫn một trang', () => {
    expect(paginateLines(lines(LINES_PER_PAGE))).toHaveLength(1)
  })

  it('không có dòng nào vẫn trả về một trang rỗng', () => {
    expect(paginateLines([])).toEqual([[]])
  })

  it('chia đều thay vì để trang cuối trơ trọi một dòng', () => {
    expect(paginateLines(lines(11), 10).map((page) => page.length)).toEqual([6, 5])
  })

  it('giữ nguyên thứ tự và không mất dòng nào', () => {
    const pages = paginateLines(lines(37), 10)
    expect(pages.flat()).toEqual(lines(37))
    expect(pages.map((page) => page.length)).toEqual([10, 10, 10, 7])
  })

  it('perPage = 0 không làm treo vòng lặp', () => {
    expect(paginateLines(lines(3), 0).map((page) => page.length)).toEqual([1, 1, 1])
  })

  it('mọi trang đều không vượt giới hạn', () => {
    for (const count of [1, 9, 10, 11, 25, 40, 100]) {
      for (const page of paginateLines(lines(count), 10)) {
        expect(page.length).toBeLessThanOrEqual(10)
      }
    }
  })
})
