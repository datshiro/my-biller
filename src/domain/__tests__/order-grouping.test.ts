import { describe, expect, it } from 'vitest'
import { groupOrdersByDay } from '../order-grouping'
import type { OrderStatus } from '../order-status'

const NOW = new Date('2026-08-07T14:00:00').getTime()
const at = (iso: string) => new Date(iso).getTime()

const order = (soldAt: number, total: number, status: OrderStatus = 'paid') => ({ soldAt, total, status })

describe('groupOrdersByDay', () => {
  it('gom theo ngày, nhóm mới nhất lên đầu', () => {
    const groups = groupOrdersByDay(
      [
        order(at('2026-08-05T09:00:00'), 50_000),
        order(at('2026-08-07T08:00:00'), 10_000),
        order(at('2026-08-06T20:00:00'), 30_000),
      ],
      NOW,
    )

    expect(groups.map((group) => group.key)).toEqual(['2026-08-07', '2026-08-06', '2026-08-05'])
  })

  it('trong một ngày cũng xếp đơn mới nhất lên đầu', () => {
    const groups = groupOrdersByDay(
      [order(at('2026-08-07T08:00:00'), 10_000), order(at('2026-08-07T13:00:00'), 20_000)],
      NOW,
    )

    expect(groups[0]?.items.map((o) => o.total)).toEqual([20_000, 10_000])
  })

  it('nhãn dùng "Hôm nay" / "Hôm qua", ngày xa hơn thì ghi rõ ngày tháng năm', () => {
    const groups = groupOrdersByDay(
      [
        order(at('2026-08-07T08:00:00'), 1),
        order(at('2026-08-06T08:00:00'), 1),
        order(at('2026-08-01T08:00:00'), 1),
      ],
      NOW,
    )

    expect(groups.map((group) => group.label)).toEqual(['Hôm nay · 07/08', 'Hôm qua · 06/08', '01/08/2026'])
  })

  it('đơn đã huỷ vẫn hiện trong nhóm nhưng không cộng vào tổng ngày', () => {
    const [group] = groupOrdersByDay(
      [
        order(at('2026-08-07T08:00:00'), 100_000),
        order(at('2026-08-07T09:00:00'), 70_000, 'void'),
      ],
      NOW,
    )

    expect(group?.items).toHaveLength(2)
    expect(group?.total).toBe(100_000)
  })

  it('đơn chưa trả vẫn tính đủ vào doanh thu ngày — doanh thu là tiền bán, không phải tiền đã cầm', () => {
    const [group] = groupOrdersByDay([order(at('2026-08-07T08:00:00'), 200_000, 'unpaid')], NOW)

    expect(group?.total).toBe(200_000)
  })

  it('không có đơn nào thì không có nhóm nào', () => {
    expect(groupOrdersByDay([], NOW)).toEqual([])
  })
})
