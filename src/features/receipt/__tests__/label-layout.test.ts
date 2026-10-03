import { describe, expect, it } from 'vitest'
import { cornerLogoSide, labelBodyStyle, lineBlocks, watermarkBox } from '../label-layout'
import type { OrderLine } from '@/domain/schema'
import { COUNTER_HEIGHT, labelDots, type LabelSize } from '@/domain/tspl/encode'

const size = { widthMm: 50, heightMm: 30, gapMm: 2 }
const line = (over: Partial<OrderLine>) => ({ name: 'Cà phê sữa', note: '', options: [], toppings: [], ...over }) as OrderLine

describe('lineBlocks', () => {
  it('đúng thứ tự người pha đọc: tuỳ chọn, topping, ghi chú khách', () => {
    const blocks = lineBlocks(
      line({
        options: ['Ít đường', 'Đá riêng'],
        toppings: [
          { name: 'Trân châu', unitPrice: 5_000, qty: 2 },
          { name: 'Thạch', unitPrice: 3_000, qty: 1 },
        ],
        note: 'mang về',
      }),
    )

    expect(blocks).toEqual([
      { kind: 'options', text: 'Ít đường, Đá riêng' },
      { kind: 'toppings', text: '+ Trân châu x2, Thạch' },
      { kind: 'note', text: 'mang về' },
    ])
  })

  it('hạng mục trống thì không sinh khối, không có gì thì thân tem trống', () => {
    expect(lineBlocks(line({ note: 'mang về' }))).toEqual([{ kind: 'note', text: 'mang về' }])
    expect(lineBlocks(line({}))).toEqual([])
  })
})

describe('labelBodyStyle', () => {
  it('ba hạng mục khác nhau bằng kiểu chữ, cùng cỡ chữ để phép đo chia trang nhất quán', () => {
    const options = labelBodyStyle(size, 'options')
    const toppings = labelBodyStyle(size, 'toppings')
    const note = labelBodyStyle(size, 'note')

    expect(options.fontSize).toBe(toppings.fontSize)
    expect(options.fontSize).toBe(note.fontSize)
    expect(toppings.fontWeight).toBe(700)
    expect(note.fontStyle).toBe('italic')
    expect(options.fontWeight).toBeUndefined()
    expect(options.fontStyle).toBeUndefined()
  })
})

const SIZES: LabelSize[] = [
  { widthMm: 30, heightMm: 25, gapMm: 2 },
  { widthMm: 50, heightMm: 30, gapMm: 2 },
  { widthMm: 72, heightMm: 100, gapMm: 2 },
]

describe('hộp logo trên tem', () => {
  it('logo góc trên phải ở tem 50×30 cạnh 46 chấm (~5,75 mm)', () => {
    expect(cornerLogoSide(size)).toBe(46)
  })

  it.each(SIZES)('khổ $widthMm×$heightMm: hộp nằm trọn trong tem, hộp giữa không chạm hàng số thứ tự', (labelSize) => {
    const { width, height } = labelDots(labelSize)
    for (const position of ['center', 'corner'] as const) {
      const box = watermarkBox(labelSize, position)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.y + box.height).toBeLessThanOrEqual(height)
    }
    const center = watermarkBox(labelSize, 'center')
    expect(center.y + center.height).toBeLessThanOrEqual(height - COUNTER_HEIGHT)
  })
})
