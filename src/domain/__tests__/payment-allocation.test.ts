import { describe, expect, it } from 'vitest'
import { allocateDebtPayment, type OpenOrder } from '../payment-allocation'

const orders: OpenOrder[] = [
  { orderId: 3, gid: 'c', remaining: 50_000, soldAt: 300 },
  { orderId: 1, gid: 'a', remaining: 120_000, soldAt: 100 },
  { orderId: 2, gid: 'b', remaining: 80_000, soldAt: 200 },
]

describe('allocateDebtPayment', () => {
  it('trả đơn cũ nhất trước, bất kể thứ tự đầu vào', () => {
    expect(allocateDebtPayment(orders, 150_000)).toEqual({
      allocations: [
        { orderId: 1, amount: 120_000 },
        { orderId: 2, amount: 30_000 },
      ],
      leftover: 0,
    })
  })

  it('thu vừa đủ thì đóng hết đơn, không dư', () => {
    const result = allocateDebtPayment(orders, 250_000)
    expect(result.allocations).toHaveLength(3)
    expect(result.leftover).toBe(0)
  })

  it('thu thiếu thì chỉ đóng được phần đầu', () => {
    expect(allocateDebtPayment(orders, 50_000)).toEqual({
      allocations: [{ orderId: 1, amount: 50_000 }],
      leftover: 0,
    })
  })

  it('thu dư thì báo phần dư chứ không tự tạo tiền thừa vào đơn nào', () => {
    const result = allocateDebtPayment(orders, 300_000)
    expect(result.leftover).toBe(50_000)
    expect(result.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(250_000)
  })

  it('bỏ qua đơn đã hết nợ', () => {
    const withPaid = [...orders, { orderId: 9, gid: 'z', remaining: 0, soldAt: 1 }]
    expect(allocateDebtPayment(withPaid, 10_000).allocations).toEqual([{ orderId: 1, amount: 10_000 }])
  })

  it('không còn đơn nợ thì toàn bộ tiền là phần dư', () => {
    expect(allocateDebtPayment([], 10_000)).toEqual({ allocations: [], leftover: 10_000 })
  })

  it('từ chối số tiền âm hoặc không nguyên', () => {
    expect(() => allocateDebtPayment(orders, -1)).toThrow()
    expect(() => allocateDebtPayment(orders, 1.5)).toThrow()
  })

  it('hai đơn cùng thời điểm thì phân bổ theo gid để mọi máy cho cùng kết quả', () => {
    const sameMoment: OpenOrder[] = [
      { orderId: 8, gid: 'a', remaining: 30_000, soldAt: 500 },
      { orderId: 5, gid: 'z', remaining: 30_000, soldAt: 500 },
    ]
    expect(allocateDebtPayment(sameMoment, 40_000).allocations).toEqual([
      { orderId: 8, amount: 30_000 },
      { orderId: 5, amount: 10_000 },
    ])
  })

  it('không sửa mảng đầu vào', () => {
    const input = [...orders]
    allocateDebtPayment(input, 999_999)
    expect(input.map((o) => o.orderId)).toEqual([3, 1, 2])
  })
})
