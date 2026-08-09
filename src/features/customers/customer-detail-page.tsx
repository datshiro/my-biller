import { useState } from 'react'
import { format } from 'date-fns'
import { useNavigate, useParams } from 'react-router'
import { useCustomerPriceCount } from './use-customer-prices'
import { useCustomer, useCustomerOrders } from './use-customers'
import { deleteCustomer } from '@/db/repositories/customers'
import { groupDebts, totalDebt } from '@/domain/debt'
import { formatAmount, formatVnd } from '@/domain/money'
import { CollectDebtSheet } from '@/features/debts/collect-debt-sheet'
import { useCustomerPayments } from '@/features/debts/use-debts'
import { OrderStatusChip } from '@/features/orders/order-status-chip'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { MoneyText } from '@/ui/money-text'
import { ScreenHeader } from '@/ui/screen-header'

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const customerId = id ? Number(id) : null

  const customer = useCustomer(customerId)
  const orders = useCustomerOrders(customerId)

  const history = useCustomerPayments(customerId)
  const priceCount = useCustomerPriceCount(customerId)

  const [confirming, setConfirming] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chặn cả `orders`: hai query này độc lập, query quét index luôn về sau, và trong khoảng đó
  // hai ô tiền sẽ vẽ "0 đ" y như số thật — người bán đọc nhầm là khách hết nợ.
  if (customer === undefined || orders === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }

  if (customer === null) {
    return <p className="p-6 text-muted">Không tìm thấy khách hàng này.</p>
  }

  const active = (orders ?? []).filter((order) => order.status !== 'void')
  const spent = active.reduce((sum, order) => sum + order.total, 0)
  // Cùng một hàm với màn Công nợ và card ở Báo cáo — ba chỗ hiện nợ, một chỗ tính.
  const debt = totalDebt(groupDebts(active))

  const codes = new Map(
    (orders ?? []).flatMap((order) => (order.id === undefined ? [] : [[order.id, order.code] as const])),
  )

  const remove = async () => {
    setConfirming(false)
    try {
      await deleteCustomer(customer.id ?? -1)
      void navigate('/them/khach-hang', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xoá được.')
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={customer.name} back="back" />

      <div className="flex flex-col gap-4 px-4 py-4">
        <dl className="flex flex-col gap-1 text-[15px]">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">Điện thoại</dt>
            <dd>{customer.phone.trim() || '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted">Địa chỉ</dt>
            <dd>{customer.address.trim() || '—'}</dd>
          </div>
          {customer.note.trim() ? (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted">Ghi chú</dt>
              <dd>{customer.note}</dd>
            </div>
          ) : null}
        </dl>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-card bg-surface px-4 py-3">
            <p className="label-xs text-muted">Đã mua</p>
            <MoneyText value={spent} size="lg" tone="ink" />
          </div>
          <div className={`rounded-card px-4 py-3 ${debt > 0 ? 'bg-warn-tint' : 'bg-surface'}`}>
            <p className="label-xs text-muted">Còn nợ</p>
            <MoneyText value={debt} size="lg" tone={debt > 0 ? 'warn' : 'muted'} />
          </div>
        </div>

        {debt > 0 && customer.id !== undefined ? (
          <Button size="cta" onClick={() => setCollecting(true)}>
            THU NỢ
          </Button>
        ) : null}

        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => void navigate(`/them/khach-hang/${customer.id}/sua`)}>
            Sửa thông tin
          </Button>
          <Button variant="danger" className="flex-1" onClick={() => setConfirming(true)}>
            Xoá
          </Button>
        </div>

        {error ? (
          <p role="alert" className="rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <ul className="border-t border-line">
        <li>
          <ListRow
            title="Bảng giá sỉ"
            subtitle={
              priceCount === undefined
                ? '…'
                : priceCount > 0
                  ? `${priceCount} món có giá riêng`
                  : 'Chưa đặt — khách này mua giá lẻ'
            }
            right={<span className="text-[20px] text-muted">›</span>}
            onClick={() => void navigate(`/them/khach-hang/${customer.id}/bang-gia`)}
          />
        </li>
      </ul>

      <h2 className="label-xs border-t border-line px-4 pt-4 pb-2 text-muted">Lịch sử đơn</h2>

      {orders === undefined ? (
        <ListSkeleton rows={3} />
      ) : orders.length === 0 ? (
        <p className="px-4 py-6 text-muted">Khách này chưa có đơn nào.</p>
      ) : (
        <ul className="border-t border-line">
          {orders.map((order) => (
            <li key={order.id}>
              <ListRow
                title={order.code}
                subtitle={format(order.soldAt, 'dd/MM/yyyy · HH:mm')}
                right={
                  <>
                    <span className="money block font-semibold">{formatAmount(order.total)}</span>
                    <OrderStatusChip status={order.status} />
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {history && history.payments.length > 0 ? (
        <>
          <h2 className="label-xs border-t border-line px-4 pt-4 pb-2 text-muted">Lịch sử thu tiền</h2>
          <ul className="border-t border-line">
            {history.payments.map((payment) => (
              <li key={payment.id}>
                <ListRow
                  title={formatVnd(payment.amount)}
                  subtitle={`${format(payment.paidAt, 'dd/MM/yyyy · HH:mm')} · ${
                    payment.method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'
                  } · ${codes.get(payment.orderId) ?? ''}`}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {collecting && customer.id !== undefined && history ? (
        <CollectDebtSheet
          customerId={customer.id}
          name={customer.name}
          owed={debt}
          onDone={() => setCollecting(false)}
          onClose={() => setCollecting(false)}
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Xoá khách hàng?"
          message={`“${customer.name}” sẽ bị xoá. Khách đã có đơn thì không xoá được.`}
          confirmLabel="Xoá"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  )
}
