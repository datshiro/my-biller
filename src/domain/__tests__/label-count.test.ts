import { describe, expect, it } from 'vitest'
import { labelCount } from '../label-count'

describe('labelCount', () => {
  it('mỗi phần một tem: Trà sữa ×3 + Bánh ×1 → 4 tem', () => {
    expect(labelCount([{ qty: 3 }, { qty: 1 }])).toBe(4)
  })

  it('số lượng lẻ làm tròn LÊN từng dòng: hai dòng 0,5 kg là hai phần → 2 tem, không phải 1', () => {
    expect(labelCount([{ qty: 0.5 }, { qty: 0.5 }])).toBe(2)
    expect(labelCount([{ qty: 1.2 }])).toBe(2)
  })

  it('đơn không dòng → 0 tem; dòng qty ≤ 0 không sinh tem', () => {
    expect(labelCount([])).toBe(0)
    expect(labelCount([{ qty: 0 }, { qty: -2 }, { qty: 2 }])).toBe(2)
  })
})
