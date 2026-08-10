import { addMonths, endOfDay, endOfMonth, format, startOfDay, startOfMonth } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { listExpenseCategories, listExpensesBetween } from '@/db/repositories/expenses'
import { groupByDay, type DayGroup } from '@/domain/day-grouping'
import type { Expense, ExpenseCategory } from '@/domain/schema'
import { useDayTick } from '@/ui/use-day-tick'
import { useSyncRevision } from '@/features/sync/use-sync-revision'

export type ExpenseMonth = {
  label: string
  /** Số tháng trần cho ô tổng — "CHI THÁNG 8/2026" không vừa nửa bề ngang màn hình. */
  monthNumber: number
  /** Đang ở tháng hiện tại thì hết đường đi tiếp — tháng sau chưa xảy ra. */
  canNext: boolean
  groups: DayGroup<Expense>[]
  monthTotal: number
  todayTotal: number
  /** Mốc thời gian lúc đọc dữ liệu, để component không phải tự xem đồng hồ trong lúc render. */
  now: number
}

const sum = (expenses: readonly Expense[]) => expenses.reduce((total, item) => total + item.amount, 0)

/**
 * Chi phí của một tháng, cộng thêm tổng hôm nay.
 *
 * Tháng nhận theo **độ lệch** chứ không phải mốc thời gian: state của màn không giữ đồng hồ, nên
 * qua nửa đêm hay sang tháng mới thì lần đọc kế tiếp đã tự đúng.
 *
 * Ranh giới ngày và tháng đều tính theo giờ **địa phương** — người bán ở Việt Nam ghi khoản chi lúc
 * 23:50 phải thuộc về hôm đó, không phải hôm sau theo UTC.
 */
export function useExpenseMonth(
  monthOffset: number,
  categoryId: number | null,
): ExpenseMonth | undefined {
  const day = useDayTick()
  const syncRevision = useSyncRevision()
  return useLiveQuery(async () => {
    const now = Date.now()
    const month = startOfMonth(addMonths(now, monthOffset))

    const [inMonth, inToday] = await Promise.all([
      listExpensesBetween(month.getTime(), endOfMonth(month).getTime()),
      listExpensesBetween(startOfDay(now).getTime(), endOfDay(now).getTime()),
    ])

    const matches = (expense: Expense) => categoryId === null || expense.categoryId === categoryId
    const kept = inMonth.filter(matches)

    return {
      label: `Tháng ${format(month, 'M/yyyy')}`,
      monthNumber: month.getMonth() + 1,
      canNext: monthOffset < 0,
      groups: groupByDay(
        kept,
        now,
        (expense) => expense.spentAt,
        (expense) => expense.amount,
      ),
      monthTotal: sum(kept),
      todayTotal: sum(inToday.filter(matches)),
      now,
    }
  }, [monthOffset, categoryId, day, syncRevision])
}

export function useExpenseCategories(): ExpenseCategory[] | undefined {
  return useLiveQuery(() => listExpenseCategories())
}
