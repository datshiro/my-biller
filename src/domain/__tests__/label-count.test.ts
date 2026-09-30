import { describe, expect, it } from 'vitest'
import { labelCopies, labelCount, labelSequence } from '../label-count'

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

describe('labelSequence', () => {
  it('ly có ghi chú dài: các tem của một ly đi liền nhau và mang chung số i/n theo ly', () => {
    // Đơn 3 ly: ly 1 một tem, ly 2 hai tem (ghi chú dài), ly 3 một tem.
    const seq = labelSequence([
      { pages: 1, copies: 1 },
      { pages: 2, copies: 1 },
      { pages: 1, copies: 1 },
    ])

    expect(seq).toEqual([
      { item: 0, page: 0, counter: '1/3' },
      { item: 1, page: 0, counter: '2/3' },
      { item: 1, page: 1, counter: '2/3' },
      { item: 2, page: 0, counter: '3/3' },
    ])
  })

  it('món ×2 cần 2 tem mỗi ly: ly 1 tr 1, ly 1 tr 2, ly 2 tr 1, ly 2 tr 2 — không xếp các trang 1 thành một cụm', () => {
    const seq = labelSequence([{ pages: 2, copies: 2 }])

    expect(seq.map((e) => [e.page, e.counter])).toEqual([
      [0, '1/2'],
      [1, '1/2'],
      [0, '2/2'],
      [1, '2/2'],
    ])
  })

  it('dòng không ra ly nào bị bỏ qua và không làm lệch số thứ tự hay tổng', () => {
    const seq = labelSequence([
      { pages: 1, copies: 0 },
      { pages: 1, copies: 2 },
    ])
    expect(seq.map((e) => e.counter)).toEqual(['1/2', '2/2'])
  })
})
