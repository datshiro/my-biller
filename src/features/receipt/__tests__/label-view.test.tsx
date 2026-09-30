// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LabelView } from '../label-view'
import { DEFAULT_SHOP, type Order, type OrderLine } from '@/domain/schema'

afterEach(cleanup)

const order = { code: 'PBH-260926-A001', soldAt: new Date(2026, 8, 26, 9, 5).getTime(), customerName: 'Chị Lan' } as Order
const line = { name: 'Choco Mint' } as OrderLine
const size = { widthMm: 50, heightMm: 30, gapMm: 2 }
const base = { shop: { ...DEFAULT_SHOP, name: 'Quán Nhỏ' }, order, line, size, count: 3, blocks: [], page: 1, pageCount: 1 }
const tem = (container: HTMLElement) => container.querySelector('[data-label]') as HTMLElement

describe('LabelView', () => {
  it('đầu tem: tên quán, rồi mã đơn và giờ, rồi vạch kẻ, rồi tên món — đúng khổ 400×240 chấm', () => {
    const { container } = render(<LabelView {...base} blocks={[{ kind: 'note', text: 'Ít đá' }]} />)
    const node = tem(container)
    const text = node.textContent ?? ''

    expect(text.indexOf('Quán Nhỏ')).toBeLessThan(text.indexOf('PBH-260926-A001 · 09:05 26/09'))
    expect(text.indexOf('PBH-260926-A001')).toBeLessThan(text.indexOf('Choco Mint'))
    expect(text.indexOf('Choco Mint')).toBeLessThan(text.indexOf('Ít đá'))
    expect(node.querySelector('div[style*="border-top"]')).not.toBeNull()
    expect(node.style.width).toBe('400px')
    expect(node.style.height).toBe('240px')
  })

  it('không còn tên khách trên tem', () => {
    const { container } = render(<LabelView {...base} />)
    expect(tem(container).textContent).not.toContain('Chị Lan')
  })

  it('ly một tem không có dấu phụ trang; ly nhiều tem ghi "tr k/m" ở hàng đáy', () => {
    const single = render(<LabelView {...base} />)
    expect(tem(single.container).textContent).not.toMatch(/tr \d/)
    single.unmount()

    const second = render(<LabelView {...base} page={2} pageCount={2} />)
    expect(tem(second.container).textContent).toContain('tr 2/2')
  })

  it('hàng đáy cao đúng hàng số thứ tự 24 chấm và dấu phụ trang dừng trước chỗ máy in vẽ "12/12"', () => {
    const big = { widthMm: 60, heightMm: 40, gapMm: 2 }
    const { container } = render(<LabelView {...base} size={big} count={12} page={2} pageCount={2} />)
    const mark = [...container.querySelectorAll('[data-label] p')].at(-1) as HTMLElement
    const row = mark.parentElement as HTMLElement

    expect(row.style.height).toBe('24px')
    // "12/12" = 5 × 16 = 80 chấm → số bắt đầu ở x = 480 − 80 − 8 = 392; dấu phụ trang bắt đầu ở lề 12,8.
    expect(12.8 + parseFloat(mark.style.maxWidth)).toBeLessThan(392)
  })

  it('không có thân thì không thêm dòng trống: tên quán, mã đơn, tên món', () => {
    const { container } = render(<LabelView {...base} />)
    expect(container.querySelectorAll('[data-label-body] p')).toHaveLength(0)
    expect(container.querySelectorAll('[data-label] > p')).toHaveLength(3)
  })
})
