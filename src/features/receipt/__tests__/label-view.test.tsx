// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LabelView } from '../label-view'
import { DEFAULT_SHOP, type Order, type OrderLine } from '@/domain/schema'

afterEach(cleanup)

const order = { code: 'PBH-260926-A001', soldAt: new Date(2026, 8, 26, 9, 5).getTime(), customerName: 'Chị Lan' } as Order
const line = (note: string) => ({ name: 'Choco Mint', note }) as OrderLine
const size = { widthMm: 50, heightMm: 30, gapMm: 2 }

describe('LabelView', () => {
  it('tem ghi tên món, ghi chú của món, mã đơn, giờ và tên khách; đúng khổ 400×240 chấm', () => {
    const { container } = render(
      <LabelView shop={{ ...DEFAULT_SHOP, name: 'Quán Nhỏ' }} order={order} line={line('Ít đá')} size={size} count={3} />,
    )
    const tem = container.querySelector('[data-label]') as HTMLElement

    expect(tem.textContent).toContain('Choco Mint')
    expect(tem.textContent).toContain('Ít đá')
    expect(tem.textContent).toContain('PBH-260926-A001 · 09:05 26/09')
    expect(tem.textContent).toContain('Chị Lan')
    expect(tem.style.width).toBe('400px')
    expect(tem.style.height).toBe('240px')
  })

  it('tên khách dừng trước chỗ máy in vẽ số thứ tự dài nhất, kể cả tem 60×40 in 12 tem', () => {
    const big = { widthMm: 60, heightMm: 40, gapMm: 2 }
    const { container } = render(<LabelView shop={DEFAULT_SHOP} order={order} line={line('')} size={big} count={12} />)
    const khách = [...container.querySelectorAll('[data-label] p')].at(-1) as HTMLElement

    // "12/12" phóng đôi: 5 × 48 = 240 chấm → số bắt đầu ở x = 480 − 240 − 8 = 232; tên khách bắt đầu ở
    // lề 12,8 nên phải dừng trước 232.
    expect(12.8 + parseFloat(khách.style.maxWidth)).toBeLessThan(232)
  })

  it('món không có ghi chú → không thêm dòng trống', () => {
    const { container } = render(<LabelView shop={DEFAULT_SHOP} order={order} line={line('')} size={size} count={3} />)
    expect(container.querySelectorAll('[data-label] p')).toHaveLength(3)
  })
})
