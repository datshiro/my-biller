import { describe, expect, it } from 'vitest'
import { deriveStatus, remainingOf } from '../order-status'

describe('deriveStatus', () => {
  it.each([
    [100_000, 100_000, 'paid'],
    [100_000, 120_000, 'paid'],
    [100_000, 1, 'partial'],
    [100_000, 99_999, 'partial'],
    [100_000, 0, 'unpaid'],
    [0, 0, 'paid'],
  ])('tổng %i, đã trả %i → %s', (total, paid, expected) => {
    expect(deriveStatus(total, paid)).toBe(expected)
  })
})

describe('remainingOf', () => {
  it('số còn nợ không bao giờ âm', () => {
    expect(remainingOf(100_000, 30_000)).toBe(70_000)
    expect(remainingOf(100_000, 150_000)).toBe(0)
  })
})
