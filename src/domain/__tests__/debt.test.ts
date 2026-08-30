import { describe, expect, it } from 'vitest'
import { daysOwed, groupDebts, owingOf, receiptDebt, totalDebt } from '../debt'
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

describe('receiptDebt', () => {
  it('gộp nợ cũ với đơn đang in, không đếm đôi', () => {
    // Bộ mẫu: Anh Hùng nợ sẵn 100.000, giờ bán nợ thêm 55.000.
    const đangIn = order(1, 55_000, 0, 5)
    const cũ = order(1, 150_000, 50_000, 1)

    expect(receiptDebt(đangIn, [cũ, đangIn])).toEqual({ prior: 100_000, totalDue: 155_000 })
  })

  it('khách chưa nợ gì thì nợ cũ bằng 0 và tổng phải trả đúng bằng đơn này', () => {
    const đangIn = order(1, 55_000, 0, 5)
    expect(receiptDebt(đangIn, [đangIn])).toEqual({ prior: 0, totalDue: 55_000 })
  })

  it('đơn đã trả đủ của khách không nợ gì thì cả hai số đều 0', () => {
    const đangIn = order(1, 55_000, 55_000, 5, 'paid')
    expect(receiptDebt(đangIn, [đangIn])).toEqual({ prior: 0, totalDue: 0 })
  })

  it('khách lẻ không bao giờ có nợ luỹ kế', () => {
    const đangIn = order(null, 55_000, 0, 5)
    expect(receiptDebt(đangIn, [đangIn])).toEqual({ prior: 0, totalDue: 0 })
  })

  it('tiền trả trước nhiều hơn nợ cũ: tổng phải trả bằng ĐÚNG màn Công nợ, không bằng nợ của đơn này', () => {
    // Ca RT-1. Khách có credit chưa phân bổ (thu tiền rồi đơn bị huỷ). `groupDebts` kẹp ở 0 và xoá
    // hẳn nhóm, nên "tính nợ cũ riêng rồi cộng" ra số khác màn Công nợ — phiếu đòi thừa tiền.
    const đangIn = order(1, 55_000, 0, 5)
    const credit = new Map([[1, 30_000]])

    const { prior, totalDue } = receiptDebt(đangIn, [đangIn], credit)
    expect(totalDue).toBe(25_000)
    expect(prior).toBe(0)
    // Chốt chặn thật: phiếu KHÔNG được đòi 55.000 trong khi màn Công nợ hiện 25.000.
    expect(totalDue).toBeLessThan(owingOf(đangIn))
  })

  it('đơn đang in bị huỷ thì không thổi phồng nợ cũ', () => {
    // Trừ bằng `owingOf` chứ không `remainingOf`: đơn void không nợ ai, nên phải bằng 0 ở CẢ HAI vế.
    const đãHuỷ = order(1, 55_000, 0, 5, 'void')
    const cũ = order(1, 150_000, 50_000, 1)

    expect(receiptDebt(đãHuỷ, [cũ, đãHuỷ])).toEqual({ prior: 100_000, totalDue: 100_000 })
  })
})

