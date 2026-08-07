import { useState } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router'
import { OrderStatusChip } from './order-status-chip'
import { useOrderWindow } from './use-orders'
import { useToday } from '@/features/sales/use-today'
import { formatAmount } from '@/domain/money'
import { remainingOf } from '@/domain/order-status'
import type { OrderSummary } from '@/db/repositories/orders'
import type { Order } from '@/domain/schema'
import { Button } from '@/ui/button'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ScreenHeader } from '@/ui/screen-header'

const FIRST_WINDOW_DAYS = 7
const MORE_DAYS = 30

const METHOD: Record<'cash' | 'transfer', string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' }

function subtitleOf(order: Order, summary: OrderSummary | undefined): string {
  const parts = [format(order.soldAt, 'HH:mm')]
  if (summary && summary.lineCount > 0) parts.push(`${summary.lineCount} món`)

  if (order.status === 'void') return parts.join(' · ')

  const remaining = remainingOf(order.total, order.paidAmount)
  if (remaining > 0) parts.push(`Còn nợ ${formatAmount(remaining)}`)
  else if (summary && summary.methods.length > 0) parts.push(summary.methods.map((m) => METHOD[m]).join(' + '))

  return parts.join(' · ')
}

export function OrderListPage() {
  const navigate = useNavigate()
  const [days, setDays] = useState(FIRST_WINDOW_DAYS)
  const page = useOrderWindow(days)
  const today = useToday()

  const groups = page?.groups ?? []

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Đơn hàng" />

      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <div className="rounded-card bg-surface px-3 py-2">
          <span className="label-xs block text-muted">DOANH THU HÔM NAY</span>
          <span className="money block text-[22px] font-bold text-brand">
            {today ? formatAmount(today.revenue) : '…'}
          </span>
        </div>
        <div className="rounded-card bg-surface px-3 py-2">
          <span className="label-xs block text-muted">SỐ ĐƠN</span>
          <span className="money block text-[22px] font-bold">{today ? today.orderCount : '…'}</span>
        </div>
      </div>

      {page === undefined ? (
        <ListSkeleton />
      ) : groups.length === 0 ? (
        <EmptyState
          message="Chưa có đơn nào trong khoảng này. Bán một đơn là nó hiện ở đây ngay."
          actionLabel="Sang màn Bán hàng"
          onAction={() => void navigate('/')}
        />
      ) : (
        groups.map((group) => (
          <section key={group.key}>
            <div className="flex items-baseline justify-between bg-surface px-4 py-1.5">
              <span className="label-xs text-muted">{group.label}</span>
              <span className="money text-[13px] font-bold text-muted">{formatAmount(group.total)} đ</span>
            </div>
            {group.items.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => void navigate(`/don/${order.id}`)}
                className="flex min-h-[60px] w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left active:bg-surface"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${order.status === 'void' ? 'text-muted line-through' : ''}`}>
                    {order.code.slice(-3)} · {order.customerName}
                  </span>
                  <span className="block truncate text-[13px] text-muted">
                    {subtitleOf(order, order.id === undefined ? undefined : page.summaries.get(order.id))}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`money block font-bold ${order.status === 'void' ? 'text-muted line-through' : ''}`}>
                    {formatAmount(order.total)}
                  </span>
                  <OrderStatusChip status={order.status} />
                </span>
              </button>
            ))}
          </section>
        ))
      )}

      {page?.hasOlder ? (
        <div className="px-4 py-4">
          <Button variant="secondary" className="w-full" onClick={() => setDays((current) => current + MORE_DAYS)}>
            Xem thêm {MORE_DAYS} ngày trước
          </Button>
        </div>
      ) : null}
    </div>
  )
}
