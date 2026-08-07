import { useState } from 'react'
import { Link } from 'react-router'
import { CogsWarning } from './cogs-warning'
import { RangeSheet, type Range } from './range-sheet'
import { RevenueExpenseChart } from './revenue-expense-chart'
import { useReport, type Period } from './use-report'
import { formatAmount, formatQty, formatVnd } from '@/domain/money'
import type { TopItem } from '@/domain/report'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { MonthPicker } from '@/ui/month-picker'
import { ScreenHeader } from '@/ui/screen-header'

const PERIODS: { period: Period; label: string }[] = [
  { period: { kind: 'today' }, label: 'Hôm nay' },
  { period: { kind: 'week' }, label: '7 ngày' },
  { period: { kind: 'month', offset: 0 }, label: 'Tháng' },
]

const TOP_PREVIEW = 5

function StatBox({ label, amount, tone }: { label: string; amount: number; tone?: 'brand' | 'danger' }) {
  const color = tone === 'brand' ? 'text-brand' : tone === 'danger' ? 'text-danger' : ''
  return (
    <div className="rounded-card bg-surface px-3 py-2">
      <span className="label-xs block text-muted">{label}</span>
      <span className={`money block text-[20px] font-bold ${color}`}>{formatAmount(amount)}</span>
    </div>
  )
}

function TopItemRow({ item }: { item: TopItem }) {
  const parts = [`SL ${formatQty(item.qty)}`]
  // Thiếu giá nhập ở bất kỳ dòng nào thì con số lãi sẽ cao giả — thà không hiện còn hơn hiện sai.
  if (item.hasFullCost) parts.push(`lãi ${formatAmount(item.amount - item.cogs)}`)
  else parts.push('chưa có giá nhập')

  return (
    <ListRow
      title={item.name}
      subtitle={parts.join(' · ')}
      right={<span className="money font-bold">{formatAmount(item.amount)}</span>}
    />
  )
}

export function ReportPage() {
  const [period, setPeriod] = useState<Period>({ kind: 'month', offset: 0 })
  const [pickingRange, setPickingRange] = useState(false)
  const [showAllItems, setShowAllItems] = useState(false)

  const report = useReport(period)

  const shiftMonth = (by: number) =>
    setPeriod((current) =>
      current.kind === 'month' ? { kind: 'month', offset: current.offset + by } : current,
    )

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Báo cáo" />

      <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2">
        {PERIODS.map((choice) => (
          <SelectChip
            key={choice.period.kind}
            selected={period.kind === choice.period.kind}
            onClick={() => setPeriod(choice.period)}
          >
            {choice.label}
          </SelectChip>
        ))}
        {/* Mở bảng chọn ngày trước, chọn xong mới đổi kỳ — bấm nhầm chip không làm mất kỳ đang xem. */}
        <SelectChip selected={period.kind === 'custom'} onClick={() => setPickingRange(true)}>
          Tuỳ chọn
        </SelectChip>
      </div>

      {period.kind === 'month' ? (
        <div className="flex justify-center border-b border-line py-1">
          <MonthPicker
            label={report?.label ?? '…'}
            canNext={report?.canNext ?? false}
            onPrev={() => shiftMonth(-1)}
            onNext={() => shiftMonth(1)}
          />
        </div>
      ) : null}

      {period.kind === 'custom' ? (
        <div className="flex items-center justify-center gap-2 border-b border-line py-1">
          <span className="font-semibold">{report?.label ?? '…'}</span>
          <Button variant="ghost" className="h-10 px-2 text-[13px]" onClick={() => setPickingRange(true)}>
            Đổi
          </Button>
        </div>
      ) : null}

      {report === undefined ? (
        <ListSkeleton />
      ) : (
        <ReportBody
          report={report}
          showAllItems={showAllItems}
          onToggleItems={() => setShowAllItems((shown) => !shown)}
        />
      )}

      {pickingRange && report !== undefined ? (
        <RangeSheet
          now={report.now}
          initial={period.kind === 'custom' ? period : null}
          onApply={(range: Range) => {
            setPeriod({ kind: 'custom', ...range })
            setPickingRange(false)
          }}
          onClose={() => setPickingRange(false)}
        />
      ) : null}
    </div>
  )
}

function ReportBody({
  report,
  showAllItems,
  onToggleItems,
}: {
  report: NonNullable<ReturnType<typeof useReport>>
  showAllItems: boolean
  onToggleItems: () => void
}) {
  const { numbers, label, debt } = report
  const profitable = numbers.profit >= 0
  const isEmpty = numbers.revenue === 0 && numbers.expense === 0
  const owed = numbers.revenue - numbers.collected
  const items = showAllItems ? numbers.topItems : numbers.topItems.slice(0, TOP_PREVIEW)

  return (
    <>
      <div className="px-4 py-3">
        <div
          className={`rounded-card border px-3 py-3 ${
            profitable ? 'border-brand bg-brand-tint' : 'border-danger bg-danger-tint'
          }`}
        >
          <span className={`label-xs block ${profitable ? 'text-brand' : 'text-danger'}`}>
            {profitable ? 'LỢI NHUẬN' : 'LỖ'} {label.toUpperCase()}
          </span>
          <span
            className={`money block text-[32px] font-bold ${profitable ? 'text-brand' : 'text-danger'}`}
          >
            {formatVnd(Math.abs(numbers.profit))}
          </span>
          {/* Công thức viết thẳng ra: con số lãi mà không nói tính từ đâu thì không ai dám tin. */}
          <span className="mt-0.5 block text-[13px] text-muted">
            Doanh thu {formatAmount(numbers.revenue)} − Giá vốn {formatAmount(numbers.cogs)} − Chi phí{' '}
            {formatAmount(numbers.expense)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <StatBox label="DOANH THU" amount={numbers.revenue} tone="brand" />
        <StatBox label="ĐÃ THU" amount={numbers.collected} />
        {numbers.cogs > 0 ? <StatBox label="GIÁ VỐN" amount={numbers.cogs} /> : null}
        <StatBox label="CHI PHÍ" amount={numbers.expense} tone="danger" />
      </div>

      {owed !== 0 ? (
        <p className="px-4 pb-3 text-[13px] text-muted">
          {owed > 0
            ? `“Doanh thu” là tiền đã bán, “Đã thu” là tiền đã cầm — chênh ${formatVnd(owed)} là khách còn nợ kỳ này.`
            : `“Đã thu” cao hơn “Doanh thu” ${formatVnd(-owed)} vì kỳ này có thu tiền nợ của đơn bán trước đó.`}
        </p>
      ) : null}

      <CogsWarning
        maybeDoubleCounted={report.maybeDoubleCounted}
        costCoverage={numbers.costCoverage}
      />

      <RevenueExpenseChart daily={report.daily} />

      {isEmpty ? (
        <EmptyState message={`${label} chưa có đơn nào và cũng chưa ghi khoản chi nào.`} />
      ) : numbers.topItems.length > 0 ? (
        <section>
          <div className="flex items-baseline justify-between bg-surface px-4 py-1.5">
            <span className="label-xs text-muted">Bán chạy nhất</span>
            {numbers.topItems.length > TOP_PREVIEW ? (
              <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={onToggleItems}>
                {showAllItems ? 'Thu gọn' : `Xem tất cả (${numbers.topItems.length})`}
              </Button>
            ) : null}
          </div>
          <ul>
            {items.map((item) => (
              <li key={item.key}>
                <TopItemRow item={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {debt.total > 0 ? (
        <div className="px-4 py-3">
          <Link
            to="/cong-no"
            className="flex items-center gap-3 rounded-card border border-warn/25 bg-warn-tint px-3 py-2.5 active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span className="label-xs block text-warn">KHÁCH CÒN NỢ</span>
              <span className="money block text-[20px] font-bold text-warn">{formatVnd(debt.total)}</span>
              <span className="block text-[13px] text-muted">
                {debt.customerCount} khách · tính trên toàn bộ đơn chưa trả đủ, không riêng kỳ này
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-[22px] text-warn">
              ›
            </span>
          </Link>
        </div>
      ) : null}
    </>
  )
}
