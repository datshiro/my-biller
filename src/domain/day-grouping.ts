import { format, isSameDay, startOfDay, subDays } from 'date-fns'

export type DayGroup<T> = {
  /** `yyyy-MM-dd` — ổn định giữa các lần render, dùng làm key React. */
  key: string
  label: string
  total: number
  items: T[]
}

function labelOf(when: number, now: number): string {
  const day = format(when, 'dd/MM')
  if (isSameDay(when, now)) return `Hôm nay · ${day}`
  if (isSameDay(when, subDays(now, 1))) return `Hôm qua · ${day}`
  return format(when, 'dd/MM/yyyy')
}

/**
 * Gom bản ghi theo ngày **giờ địa phương**, ngày mới nhất lên đầu, mỗi nhóm kèm tổng tiền.
 *
 * `amount` trả 0 cho bản ghi không được cộng vào tổng (đơn đã huỷ) — nó vẫn nằm trong `items`,
 * vì người bán cần thấy nó tồn tại.
 */
export function groupByDay<T>(
  records: readonly T[],
  now: number,
  at: (record: T) => number,
  amount: (record: T) => number,
): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>()

  for (const record of [...records].sort((a, b) => at(b) - at(a))) {
    const when = at(record)
    const key = format(when, 'yyyy-MM-dd')
    let group = groups.get(key)
    if (!group) {
      group = { key, label: labelOf(startOfDay(when).getTime(), now), total: 0, items: [] }
      groups.set(key, group)
    }
    group.items.push(record)
    group.total += amount(record)
  }

  return [...groups.values()]
}
