import { describe, expect, it } from 'vitest'
import {
  aggregate,
  aggregateCogs,
  aggregateCollected,
  aggregateExpense,
  aggregateRevenue,
  costCoverage,
  dailySeries,
  topItems,
} from '../report'
import type { OrderStatus } from '../order-status'

const at = (d: number, h = 10) => new Date(2026, 7, d, h).getTime()

const order = (soldAt: number, total: number, status: OrderStatus = 'paid', id = 1) => ({
  id,
  soldAt,
  total,
  status,
})
const line = (
  name: string,
  qty: number,
  amount: number,
  costPrice: number | null,
  itemId: number | null = 1,
  orderId = 1,
) => ({ orderId, itemId, name, qty, amount, costPrice })

describe('aggregateRevenue', () => {
  it('cộng tổng đơn, bỏ đơn đã huỷ', () => {
    const orders = [order(at(1), 100_000), order(at(2), 50_000, 'unpaid'), order(at(3), 999_000, 'void')]
    expect(aggregateRevenue(orders)).toBe(150_000)
  })

  it('doanh thu tính theo tiền đơn, không phải tiền đã cầm', () => {
    expect(aggregateRevenue([order(at(1), 200_000, 'unpaid')])).toBe(200_000)
  })
})

describe('aggregateCollected', () => {
  it('cộng phiếu thu; chênh với doanh thu chính là công nợ', () => {
    const revenue = aggregateRevenue([order(at(1), 200_000, 'partial')])
    const collected = aggregateCollected([{ amount: 50_000 }, { amount: 30_000 }])
    expect(collected).toBe(80_000)
    expect(revenue - collected).toBe(120_000)
  })
})

describe('aggregateCogs', () => {
  it('làm tròn giá vốn ở từng dòng', () => {
    expect(aggregateCogs([line('Thịt', 0.5, 60_000, 12_501)])).toBe(6_251)
  })

  it('bỏ qua dòng chưa nhập giá vốn thay vì coi là lãi 100%', () => {
    const lines = [line('Phở', 2, 110_000, 30_000), line('Trà đá', 2, 6_000, null)]
    expect(aggregateCogs(lines)).toBe(60_000)
  })
})

describe('aggregateExpense', () => {
  it('cộng các khoản chi', () => {
    expect(aggregateExpense([{ amount: 1_200_000 }, { amount: 300_000 }])).toBe(1_500_000)
  })
})

describe('costCoverage', () => {
  it('mọi dòng đều có giá nhập → phủ hết', () => {
    expect(costCoverage([line('Phở', 1, 55_000, 30_000)])).toBe(1)
  })

  it('tính theo tiền chứ không theo số dòng — dòng to bỏ trống nguy hiểm hơn dòng nhỏ', () => {
    const lines = [line('Phở', 1, 90_000, 30_000), line('Trà đá', 1, 10_000, null)]
    expect(costCoverage(lines)).toBe(0.9)
  })

  it('kỳ không bán gì → 1, không phải NaN', () => {
    expect(costCoverage([])).toBe(1)
  })
})

describe('topItems', () => {
  it('gộp theo mặt hàng và xếp theo doanh thu giảm dần', () => {
    const lines = [
      line('Phở bò', 2, 110_000, 30_000, 1),
      line('Phở bò', 1, 55_000, 30_000, 1),
      line('Trà đá', 10, 30_000, 500, 2),
    ]
    expect(topItems(lines)).toEqual([
      { key: 'item:1', name: 'Phở bò', qty: 3, amount: 165_000, cogs: 90_000, hasFullCost: true },
      { key: 'item:2', name: 'Trà đá', qty: 10, amount: 30_000, cogs: 5_000, hasFullCost: true },
    ])
  })

  it('thiếu giá nhập ở một dòng thôi là cả món mất tư cách khoe lãi', () => {
    const lines = [line('Phở bò', 2, 110_000, 30_000, 1), line('Phở bò', 1, 55_000, null, 1)]
    expect(topItems(lines)[0]).toMatchObject({ qty: 3, amount: 165_000, cogs: 60_000, hasFullCost: false })
  })

  it('mặt hàng nhập tay (không có itemId) gộp theo tên', () => {
    const lines = [line('Bánh mì', 1, 20_000, null, null), line('Bánh mì', 2, 40_000, null, null)]
    expect(topItems(lines)).toEqual([
      { key: 'name:Bánh mì', name: 'Bánh mì', qty: 3, amount: 60_000, cogs: 0, hasFullCost: false },
    ])
  })

  it('doanh thu bằng nhau thì xếp theo tên để bảng không nhảy loạn giữa các lần mở', () => {
    const lines = [line('Trà đá', 1, 30_000, null, 2), line('Bánh mì', 1, 30_000, null, 1)]
    expect(topItems(lines).map((item) => item.name)).toEqual(['Bánh mì', 'Trà đá'])
  })

  it('cắt đúng số lượng yêu cầu', () => {
    const lines = [line('A', 1, 30_000, null, 1), line('B', 1, 20_000, null, 2), line('C', 1, 10_000, null, 3)]
    expect(topItems(lines, 2).map((item) => item.name)).toEqual(['A', 'B'])
  })
})

describe('dailySeries', () => {
  it('điền 0 cho ngày không phát sinh để biểu đồ không nhảy cóc', () => {
    const orders = [order(at(1), 100_000), order(at(1, 20), 50_000), order(at(3), 70_000)]
    const expenses = [{ spentAt: at(2), amount: 20_000 }]
    expect(dailySeries(orders, expenses, at(1), at(3))).toEqual([
      { day: '2026-08-01', revenue: 150_000, expense: 0 },
      { day: '2026-08-02', revenue: 0, expense: 20_000 },
      { day: '2026-08-03', revenue: 70_000, expense: 0 },
    ])
  })

  it('không tính đơn đã huỷ vào biểu đồ', () => {
    expect(dailySeries([order(at(1), 100_000, 'void')], [], at(1), at(1))).toEqual([
      { day: '2026-08-01', revenue: 0, expense: 0 },
    ])
  })
})

describe('aggregate', () => {
  it('lợi nhuận = doanh thu − giá vốn − chi phí, ba thành phần vẫn tách riêng', () => {
    const numbers = aggregate({
      orders: [order(at(1), 165_000)],
      lines: [line('Phở bò', 3, 165_000, 30_000)],
      expenses: [{ amount: 20_000 }],
      payments: [{ amount: 165_000 }],
    })

    expect(numbers).toMatchObject({
      revenue: 165_000,
      cogs: 90_000,
      expense: 20_000,
      profit: 55_000,
      collected: 165_000,
    })
  })

  it('đơn huỷ bị loại khỏi CẢ doanh thu lẫn giá vốn và bảng bán chạy', () => {
    const numbers = aggregate({
      orders: [order(at(1), 100_000, 'paid', 1), order(at(2), 999_000, 'void', 2)],
      lines: [
        line('Phở bò', 1, 100_000, 30_000, 1, 1),
        line('Bò kobe', 1, 999_000, 800_000, 9, 2),
      ],
      expenses: [],
      payments: [],
    })

    expect(numbers.revenue).toBe(100_000)
    expect(numbers.cogs).toBe(30_000)
    expect(numbers.topItems.map((item) => item.name)).toEqual(['Phở bò'])
  })

  it('bán nợ: doanh thu tính đủ ngay, đã thu chỉ bằng tiền thật sự cầm', () => {
    const numbers = aggregate({
      orders: [order(at(1), 200_000, 'partial')],
      lines: [line('Phở bò', 4, 200_000, null)],
      expenses: [],
      payments: [{ amount: 50_000 }],
    })

    expect(numbers.revenue).toBe(200_000)
    expect(numbers.collected).toBe(50_000)
  })

  it('kỳ rỗng → tất cả 0, không NaN, không chia 0', () => {
    const numbers = aggregate({ orders: [], lines: [], expenses: [], payments: [] })

    expect(numbers).toEqual({
      revenue: 0,
      collected: 0,
      cogs: 0,
      expense: 0,
      profit: 0,
      costCoverage: 1,
      topItems: [],
    })
    expect(Object.values(numbers).some((value) => Number.isNaN(value))).toBe(false)
  })

  it('chi phí lớn hơn doanh thu → lãi âm, không kẹp về 0', () => {
    const numbers = aggregate({
      orders: [order(at(1), 100_000)],
      lines: [line('Phở bò', 1, 100_000, null)],
      expenses: [{ amount: 500_000 }],
      payments: [],
    })

    expect(numbers.profit).toBe(-400_000)
  })
})
