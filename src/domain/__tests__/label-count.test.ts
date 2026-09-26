import { describe, expect, it } from 'vitest'
import { labelCopies, labelCount } from '../label-count'

describe('labelCount / labelCopies', () => {
  it('mỗi phần một tem: Trà sữa ×3 + Bánh ×1 → 4 tem, chia 3 và 1 theo dòng', () => {
    expect(labelCopies([{ qty: 3 }, { qty: 1 }])).toEqual([3, 1])
    expect(labelCount([{ qty: 3 }, { qty: 1 }])).toBe(4)
  })

  it('số lượng lẻ làm tròn LÊN từng dòng: hai dòng 0,5 kg là hai phần → 2 tem, không phải 1', () => {
    expect(labelCount([{ qty: 0.5 }, { qty: 0.5 }])).toBe(2)
    expect(labelCopies([{ qty: 1.2 }])).toEqual([2])
  })

  it('đơn không dòng → 0 tem; dòng qty ≤ 0 không sinh tem', () => {
    expect(labelCount([])).toBe(0)
    expect(labelCopies([{ qty: 0 }, { qty: -2 }, { qty: 2 }])).toEqual([0, 0, 2])
  })
})
