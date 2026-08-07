import { format, parseISO } from 'date-fns'
import { formatVnd } from '@/domain/money'
import type { DailyPoint } from '@/domain/report'

/**
 * Cột thu-chi 7 ngày, vẽ bằng CSS thuần thay vì thư viện biểu đồ.
 *
 * Recharts đo được ~94KB gzip cho đúng một `BarChart` — gấp rưỡi toàn bộ JS hiện có của app, trong
 * khi màn này chỉ cần 7 cột tĩnh, không tooltip, không zoom. App chạy offline và tải hết về máy yếu
 * nên đây là chỗ tiền bundle không đáng tiêu.
 *
 * Cao theo tỷ lệ với ngày lớn nhất trong 7 ngày, **chung một thang cho cả thu lẫn chi** — hai thang
 * riêng sẽ khiến cột chi trông ngang cột thu ở ngày lỗ nặng.
 */
export function RevenueExpenseChart({ daily }: { daily: readonly DailyPoint[] }) {
  const peak = Math.max(1, ...daily.map((point) => Math.max(point.revenue, point.expense)))
  const height = (value: number) => (value === 0 ? 0 : Math.max(2, (value / peak) * 100))

  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="label-xs text-muted">7 ngày gần nhất</span>
        <span className="flex items-center gap-3 text-[12px] text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-brand" /> Thu
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-danger/75" /> Chi
          </span>
        </span>
      </div>

      <ul className="flex h-[120px] items-end gap-1.5 border-b border-line">
        {daily.map((point) => (
          <li
            key={point.day}
            // Hai cột cạnh nhau, không chồng lên nhau: xếp chồng thì mắt đọc ra tổng thu+chi.
            className="flex h-full flex-1 items-end gap-px"
            title={`${format(parseISO(point.day), 'dd/MM')} · thu ${formatVnd(point.revenue)} · chi ${formatVnd(point.expense)}`}
          >
            <span
              className="block flex-1 rounded-t-sm bg-brand"
              style={{ height: `${height(point.revenue)}%` }}
            />
            <span
              className="block flex-1 rounded-t-sm bg-danger/75"
              style={{ height: `${height(point.expense)}%` }}
            />
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex gap-1.5">
        {daily.map((point) => (
          <span key={point.day} className="flex-1 text-center text-[10px] text-muted">
            {format(parseISO(point.day), 'dd')}
          </span>
        ))}
      </div>
    </section>
  )
}
