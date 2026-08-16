import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { useNavigate, useParams } from 'react-router'
import { OrderStatusChip } from './order-status-chip'
import { useOrderDetail } from './use-orders'
import { updateOrderNote, voidOrder } from '@/db/repositories/orders'
import { resolveUnallocatedPayment } from '@/db/repositories/payments'
import { formatAmount, formatQty, formatVnd } from '@/domain/money'
import { remainingOf } from '@/domain/order-status'
import type { Payment } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { EmptyState } from '@/ui/empty-state'
import { ScreenHeader } from '@/ui/screen-header'
import { TextField } from '@/ui/text-field'

const METHOD: Record<Payment['method'], string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' }

type RetailPaymentAction = {
  kind: 'refunded' | 'discarded'
  payment: Payment
}

function paymentLabel(payment: Payment, voidedRetailOrder: boolean): string {
  if (!voidedRetailOrder || payment.allocatedOrderId !== 0) return 'Đã trả'
  if (payment.unallocatedStatus === 'refunded') return 'Đã trả lại khách'
  if (payment.unallocatedStatus === 'discarded') return 'Đã bỏ, có ghi vết'
  return 'Khoản thu chờ xử lý'
}

export function OrderDetailPage() {
  const { id } = useParams()
  const orderId = Number(id)
  const navigate = useNavigate()
  const detail = useOrderDetail(orderId)

  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [paymentAction, setPaymentAction] = useState<RetailPaymentAction | null>(null)
  const [resolvingPayment, setResolvingPayment] = useState(false)
  const resolvingPaymentRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  if (detail === undefined) return <p className="p-6 text-center text-muted">Đang mở đơn…</p>
  if (detail === null) {
    return (
      <EmptyState
        message="Không tìm thấy đơn này."
        actionLabel="Về danh sách đơn"
        onAction={() => void navigate('/don', { replace: true })}
      />
    )
  }

  const { order, lines, payments } = detail
  const remaining = remainingOf(order.total, order.paidAmount)
  const voided = order.status === 'void'
  const voidedRetailOrder = voided && order.customerId === null

  const saveNote = async () => {
    if (noteDraft === null) return
    try {
      await updateOrderNote(orderId, noteDraft.trim())
      setNoteDraft(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được ghi chú.')
    }
  }

  const doVoid = async () => {
    setConfirming(false)
    try {
      await voidOrder(orderId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không huỷ được đơn.')
    }
  }

  const resolveRetailPayment = async () => {
    if (!paymentAction?.payment.id || resolvingPaymentRef.current) return
    resolvingPaymentRef.current = true
    setResolvingPayment(true)
    setError(null)
    try {
      await resolveUnallocatedPayment(paymentAction.payment.id, {
        kind: paymentAction.kind,
        reason:
          paymentAction.kind === 'refunded'
            ? `Đã trả lại tiền khách lẻ sau khi huỷ ${order.code}.`
            : `Bỏ khoản thu khách lẻ sau khi huỷ ${order.code}.`,
      })
      setPaymentAction(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xử lý được khoản thu.')
    } finally {
      resolvingPaymentRef.current = false
      setResolvingPayment(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={order.code} back="back" right={format(order.soldAt, 'dd/MM/yyyy HH:mm')} />

      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="label-xs block text-muted">KHÁCH</span>
          <span className="block truncate text-[17px] font-bold">{order.customerName}</span>
        </span>
        <OrderStatusChip status={order.status} />
      </div>

      {voided ? (
        <p className="mx-4 mb-3 rounded-btn bg-surface px-3 py-2 text-[13px] text-muted">
          Đơn này đã huỷ: không tính vào doanh thu và không còn là công nợ. Phiếu cũ vẫn xem lại được.
        </p>
      ) : null}

      <h2 className="label-xs border-t border-line px-4 pb-1 pt-3 text-muted">MẶT HÀNG</h2>
      {lines.map((line) => (
        <div key={line.id} className="flex items-baseline gap-3 border-b border-line px-4 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{line.name}</span>
            <span className="money block text-[13px] text-muted">
              {formatQty(line.qty)}
              {line.unit ? ` ${line.unit}` : ''} × {formatAmount(line.unitPrice)}
            </span>
          </span>
          <span className="money shrink-0 font-bold">{formatAmount(line.amount)}</span>
        </div>
      ))}

      <div className="px-4 py-3">
        {order.discount > 0 || order.surcharge > 0 ? (
          <p className="mb-1 text-[13px] text-muted">
            Hàng {formatAmount(order.subtotal)}
            {order.discount > 0 ? ` · giảm ${formatAmount(order.discount)}` : ''}
            {order.surcharge > 0 ? ` · phụ thu ${formatAmount(order.surcharge)}` : ''}
          </p>
        ) : null}
        <div className="flex items-baseline justify-between">
          <span className="label-xs text-muted">TỔNG CỘNG</span>
          <span className="money money-lg">{formatVnd(order.total)}</span>
        </div>
        {payments.map((payment) => {
          const pendingRetailPayment =
            voidedRetailOrder &&
            payment.allocatedOrderId === 0 &&
            (payment.unallocatedStatus ?? 'pending') === 'pending'
          return (
            <div key={payment.id} className="mt-1 text-[13px]">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">
                  {paymentLabel(payment, voidedRetailOrder)} · {METHOD[payment.method]} ·{' '}
                  {format(payment.paidAt, 'dd/MM HH:mm')}
                </span>
                <span className="money font-semibold">{formatAmount(payment.amount)}</span>
              </div>
              {pendingRetailPayment ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setPaymentAction({ kind: 'refunded', payment })}
                  >
                    Đã trả lại khách
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setPaymentAction({ kind: 'discarded', payment })}
                  >
                    Bỏ có ghi vết
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
        {remaining > 0 && !voided ? (
          <div className="mt-1 flex items-baseline justify-between">
            <span className="label-xs text-warn">CÒN NỢ</span>
            <span className="money font-bold text-warn">{formatVnd(remaining)}</span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line px-4 py-3">
        <TextField
          label="Ghi chú"
          value={noteDraft ?? order.note}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Ví dụ: giao chiều mai"
        />
        {noteDraft !== null && noteDraft.trim() !== order.note ? (
          <div className="mt-2 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setNoteDraft(null)}>
              Bỏ sửa
            </Button>
            <Button className="flex-1" onClick={() => void saveNote()}>
              Lưu ghi chú
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <p className="px-4 pb-2 text-[13px] text-danger">{error}</p> : null}

      <div className="mt-auto border-t border-line px-4 py-3">
        <Button size="cta" onClick={() => void navigate(`/don/${orderId}/phieu`)}>
          🧾 XEM PHIẾU
        </Button>
        {!voided ? (
          <Button variant="danger" className="mt-3 w-full" onClick={() => setConfirming(true)}>
            Huỷ đơn
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmDialog
          title="Huỷ đơn này?"
          message={
            order.paidAmount > 0
              ? `${order.code} đã thu ${formatVnd(order.paidAmount)}. Huỷ đơn không xoá lần thu này; tiền sẽ được đánh dấu chưa gắn vào đơn để ${
                  order.customerId === null
                    ? 'xử lý ngay tại chi tiết đơn'
                    : 'xử lý ở lịch sử khách'
                }. Đơn thôi tính vào doanh thu và công nợ. Không hoàn tác được.`
              : `${order.code} sẽ không còn tính vào doanh thu và công nợ. Không hoàn tác được.`
          }
          confirmLabel="Huỷ đơn"
          onConfirm={() => void doVoid()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}

      {paymentAction ? (
        <ConfirmDialog
          title={
            paymentAction.kind === 'refunded'
              ? 'Đã trả lại tiền cho khách?'
              : 'Bỏ khoản ghi nhận này?'
          }
          message={
            paymentAction.kind === 'refunded'
              ? 'Phiếu thu vẫn nằm trong sổ với dấu “đã trả lại”, nhưng không còn tính vào tổng đã thu.'
              : 'Phiếu thu không bị xoá; sổ giữ dấu vết rằng người bán xác nhận đây là khoản ghi nhận sai.'
          }
          confirmLabel="Xác nhận"
          pending={resolvingPayment}
          onConfirm={() => void resolveRetailPayment()}
          onCancel={() => setPaymentAction(null)}
        />
      ) : null}
    </div>
  )
}
