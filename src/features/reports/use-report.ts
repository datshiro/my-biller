import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { listExpenseCategories, listExpensesBetween } from '@/db/repositories/expenses'
import {
  listOrderLinesOfOrders,
  listOrdersBetween,
  listPaymentsBetween,
  summarizeDebt,
  type DebtSummary,
} from '@/db/repositories/orders'
import { normalizeName } from '@/domain/order-draft/parse-order-text'
import { aggregate, dailySeries, type DailyPoint, type ReportNumbers } from '@/domain/report'
import { useDayTick } from '@/ui/use-day-tick'

/**
 * Kỳ mang luôn tham số của nó (`offset`, `from`/`to`) thay vì để rời bên ngoài — nhờ vậy không tồn
 * tại trạng thái "đang chọn khoảng tuỳ chọn mà chưa có ngày".
 */
export type Period =
  | { kind: 'today' }
  | { kind: 'week' }
  | { kind: 'month'; offset: number }
  | { kind: 'custom'; from: string; to: string }

const keyOf = (period: Period): string =>
  period.kind === 'month'
    ? `month:${period.offset}`
    : period.kind === 'custom'
      ? `custom:${period.from}:${period.to}`
      : period.kind

/** Biểu đồ luôn là 7 ngày gần nhất, không đổi theo kỳ đang chọn — wireframe màn 10. */
const CHART_DAYS = 7

export type Report = {
  label: string
  /** Đang ở tháng hiện tại thì hết đường đi tiếp. Chỉ có nghĩa ở kỳ "Tháng". */
  canNext: boolean
  numbers: ReportNumbers
  daily: DailyPoint[]
  debt: DebtSummary
  /** Đồng hồ đọc lúc truy vấn. Màn hình dùng lại mốc này thay vì tự xem giờ trong lúc render. */
  now: number
  /**
   * Kỳ này vừa có giá vốn vừa có khoản chi loại nguyên liệu — dấu hiệu tiền hàng bị trừ hai lần.
   * Nhận diện theo **tên loại**, nên người bán đổi tên loại thì cảnh báo im. Chấp nhận được: thà bỏ
   * sót còn hơn cảnh báo bừa vào tiền thuê nhà.
   */
  maybeDoubleCounted: boolean
}

function rangeOf(period: Period, now: number) {
  if (period.kind === 'today') {
    return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime(), label: 'Hôm nay', canNext: false }
  }
  if (period.kind === 'week') {
    return {
      from: startOfDay(subDays(now, 6)).getTime(),
      to: endOfDay(now).getTime(),
      label: '7 ngày qua',
      canNext: false,
    }
  }
  if (period.kind === 'custom') {
    const from = startOfDay(parseISO(period.from)).getTime()
    const to = endOfDay(parseISO(period.to)).getTime()
    return { from, to, label: `${format(from, 'dd/MM')} – ${format(to, 'dd/MM/yyyy')}`, canNext: false }
  }
  const month = startOfMonth(addMonths(now, period.offset))
  return {
    from: month.getTime(),
    to: endOfMonth(month).getTime(),
    label: `Tháng ${format(month, 'M/yyyy')}`,
    canNext: period.offset < 0,
  }
}

const MATERIAL = normalizeName('Nguyên liệu')

/**
 * Số liệu của kỳ đang chọn. Kỳ nhận theo **loại + độ lệch tháng** chứ không phải mốc thời gian, nên
 * chỉ cần query chạy lại là khoảng tự đúng. Nhưng nó không tự chạy lại: `useLiveQuery` chỉ thức dậy
 * khi bảng đổi, mà quán vắng thì chẳng có gì đổi — mở kỳ "Hôm nay" lúc 23h50 rồi ngồi tới 00h20 là
 * nhãn vẫn ghi "Hôm nay" trong khi khoảng đang là hôm qua. `useDayTick` đẩy nó chạy lại lúc sang ngày.
 *
 * Đọc theo index `soldAt` / `spentAt` / `paidAt` trong khoảng, dòng hàng lấy bằng một `anyOf` —
 * không `toArray()` cả bảng, vì bảng `orderLines` là bảng lớn nhất của app.
 */
export function useReport(period: Period): Report | undefined {
  const day = useDayTick()
  return useLiveQuery(async () => {
    const now = Date.now()
    const { from, to, label, canNext } = rangeOf(period, now)
    const chartFrom = startOfDay(subDays(now, CHART_DAYS - 1)).getTime()
    const chartTo = endOfDay(now).getTime()

    const [orders, expenses, payments, debt, categories] = await Promise.all([
      listOrdersBetween(from, to),
      listExpensesBetween(from, to),
      listPaymentsBetween(from, to),
      summarizeDebt(),
      listExpenseCategories(),
    ])

    const lines = await listOrderLinesOfOrders(
      orders.flatMap((order) => (order.id === undefined ? [] : [order.id])),
    )
    const numbers = aggregate({ orders, lines, expenses, payments })

    // Kỳ chọn có thể không trùm 7 ngày của biểu đồ (ví dụ "Hôm nay"), nên đọc riêng thay vì lọc lại.
    const chartRange =
      from <= chartFrom && to >= chartTo
        ? { orders, expenses }
        : {
            orders: await listOrdersBetween(chartFrom, chartTo),
            expenses: await listExpensesBetween(chartFrom, chartTo),
          }

    const materialIds = new Set(
      categories
        .filter((category) => normalizeName(category.name) === MATERIAL)
        .flatMap((category) => (category.id === undefined ? [] : [category.id])),
    )
    const materialExpense = expenses.some(
      (expense) => expense.categoryId !== null && materialIds.has(expense.categoryId),
    )

    return {
      label,
      canNext,
      numbers,
      daily: dailySeries(chartRange.orders, chartRange.expenses, chartFrom, chartTo),
      debt,
      now,
      maybeDoubleCounted: numbers.cogs > 0 && materialExpense,
    }
  }, [keyOf(period), day])
}
