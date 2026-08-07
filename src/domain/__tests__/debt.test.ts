import { describe, expect, it } from 'vitest'
import { daysOwed, groupDebts, owingOf, totalDebt } from '../debt'
import type { OrderStatus } from '../order-status'

const order = (
  customerId: number | null,
  total: number,
  paidAmount: number,
  day: number,
  status: OrderStatus = 'unpaid',
) => ({ customerId, total, paidAmount, soldAt: new Date(2026, 7, day, 10).getTime(), status })

describe('owingOf', () => {
  it('đơn huỷ không còn nợ ai, kể cả khi chưa trả đồng nào', () => {
    expect(owingOf(order(1, 100_000, 0, 1, 'void'))).toBe(0)
  })

  it('trả dư không thành nợ âm', () => {
    expect(owingOf(order(1, 100_000, 120_000, 1, 'paid'))).toBe(0)
  })
})

describe('groupDebts', () => {
  it('gộp theo khách, nợ lâu nhất lên đầu', () => {
    const groups = groupDebts([
      order(2, 50_000, 0, 5),
      order(1, 100_000, 30_000, 3),
      order(1, 200_000, 0, 1),
    ])

    expect(groups.map((group) => [group.customerId, group.total, group.orderCount])).toEqual([
      [1, 270_000, 2],
      [2, 50_000, 1],
    ])
    expect(groups[0]?.oldestAt).toBe(new Date(2026, 7, 1, 10).getTime())
  })

  it('bỏ đơn đã trả đủ và đơn đã huỷ ra khỏi nhóm', () => {
    const groups = groupDebts([
      order(1, 100_000, 100_000, 1, 'paid'),
      order(1, 200_000, 0, 2, 'void'),
      order(1, 50_000, 0, 3),
    ])

    expect(groups).toEqual([{ customerId: 1, total: 50_000, orderCount: 1, oldestAt: new Date(2026, 7, 3, 10).getTime() }])
  })

  it('đơn không gắn khách bị loại — nợ phải có chủ', () => {
    expect(groupDebts([order(null, 100_000, 0, 1)])).toEqual([])
  })

  it('không có nợ thì tổng bằng 0, không phải NaN', () => {
    expect(totalDebt(groupDebts([]))).toBe(0)
  })
})

describe('daysOwed', () => {
  it('đếm theo ngày lịch: bán 23:00 hôm qua, 7 giờ sáng nay đã là 1 ngày', () => {
    const soldAt = new Date(2026, 7, 6, 23, 0).getTime()
    const now = new Date(2026, 7, 7, 7, 0).getTime()
    expect(daysOwed(soldAt, now)).toBe(1)
  })

  it('bán trong ngày là 0 ngày', () => {
    const soldAt = new Date(2026, 7, 7, 8, 0).getTime()
    expect(daysOwed(soldAt, new Date(2026, 7, 7, 20, 0).getTime())).toBe(0)
  })
})
