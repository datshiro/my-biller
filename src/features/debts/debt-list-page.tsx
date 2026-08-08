import { useState } from 'react'
import { CollectDebtSheet } from './collect-debt-sheet'
import { useDebts, type DebtRow } from './use-debts'
import { daysOwed } from '@/domain/debt'
import { formatAmount, formatVnd } from '@/domain/money'
import { StatusChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { ScreenHeader } from '@/ui/screen-header'

/** Quá mốc này thì nhắc — nợ để lâu càng khó đòi. */
const OVERDUE_DAYS = 30

function describe(row: DebtRow, now: number): string {
  const days = daysOwed(row.oldestAt, now)
  const age = days === 0 ? 'từ hôm nay' : `${days} ngày`
  return `${row.orderCount} đơn · ${age}`
}

export function DebtListPage() {
  const debts = useDebts()
  const [collecting, setCollecting] = useState<DebtRow | null>(null)

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Công nợ" back="back" />

      {debts === undefined ? (
        <ListSkeleton />
      ) : debts.rows.length === 0 ? (
        <EmptyState message="Chưa ai nợ tiền. Bán nợ cho khách quen thì khoản đó hiện ở đây." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <div className="rounded-card border border-warn/25 bg-warn-tint px-3 py-2">
              <span className="label-xs block text-warn">TỔNG NỢ</span>
              <span className="money block text-[20px] font-bold text-warn">
                {formatAmount(debts.total)}
              </span>
            </div>
            <div className="rounded-card bg-surface px-3 py-2">
              <span className="label-xs block text-muted">SỐ KHÁCH</span>
              <span className="money block text-[20px] font-bold">{debts.rows.length}</span>
            </div>
          </div>

          <ul className="border-t border-line">
            {debts.rows.map((row) => (
              <li key={row.customerId}>
                <ListRow
                  title={
                    <span className="flex items-center gap-2">
                      {row.name}
                      {daysOwed(row.oldestAt, debts.now) > OVERDUE_DAYS ? (
                        <StatusChip tone="danger">Quá {OVERDUE_DAYS} ngày</StatusChip>
                      ) : null}
                    </span>
                  }
                  subtitle={describe(row, debts.now)}
                  right={<span className="money font-bold text-warn">{formatVnd(row.total)}</span>}
                  onClick={() => setCollecting(row)}
                />
              </li>
            ))}
          </ul>

          <p className="px-4 py-4 text-[13px] text-muted">
            Chạm vào khách để thu nợ. Xem chi tiết từng đơn ở trang khách hàng.
          </p>
        </>
      )}

      {collecting && debts ? (
        <CollectDebtSheet
          customerId={collecting.customerId}
          name={collecting.name}
          owed={collecting.total}
          onDone={() => setCollecting(null)}
          onClose={() => setCollecting(null)}
        />
      ) : null}
    </div>
  )
}
