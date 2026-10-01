import { describe, expect, it } from 'vitest'
import { labelBodyStyle, lineBlocks } from '../label-layout'
import type { OrderLine } from '@/domain/schema'

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
