import { format } from 'date-fns'
import { RECEIPT_WIDTH } from './share-receipt'
import { formatAmount, formatQty, formatVnd } from '@/domain/money'
import { remainingOf } from '@/domain/order-status'
import type { Order, OrderLine, Payment, ShopSettings } from '@/domain/schema'

const METHOD: Record<Payment['method'], string> = {
  cash: 'tiền mặt',
  transfer: 'chuyển khoản',
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${strong ? 'text-[15px] font-bold' : 'text-[13px]'}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span className="money whitespace-nowrap">{value}</span>
    </div>
  )
}

/**
 * DOM thật của phiếu — dùng chung cho cả ảnh PNG lẫn bản in, nên **không** có nút hay trạng thái nào
 * bên trong. Bề ngang cố định `RECEIPT_WIDTH` để ảnh chụp ra giống nhau trên mọi máy.
 */
export function ReceiptView({
  shop,
  order,
  lines,
  payments,
  page = 1,
  pageCount = 1,
  innerRef,
}: {
  shop: ShopSettings
  order: Order
  /** Chỉ những dòng của trang này. Việc chia trang do `paginateLines` lo. */
  lines: readonly OrderLine[]
  payments: readonly Payment[]
  page?: number
  pageCount?: number
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const hasShopHeader = Boolean(shop.name || shop.address || shop.phone)
  const remaining = remainingOf(order.total, order.paidAmount)
  const adjusted = order.discount > 0 || order.surcharge > 0
  // Khối tiền chỉ in ở trang cuối. Đầu phiếu thì lặp lại trên mọi trang, vì mỗi trang là một tấm ảnh
  // rời — khách xem tấm thứ ba mà không biết phiếu nào, của quán nào thì vô nghĩa.
  const isLast = page === pageCount

  return (
    <div
      ref={innerRef}
      className="receipt-view receipt-page mx-auto bg-white px-4 py-5 text-ink"
      style={{ width: RECEIPT_WIDTH }}
    >
      {/* Lần chạy đầu chưa đặt tên quán: bỏ hẳn khối này, không in dòng trống lên phiếu của khách. */}
      {hasShopHeader ? (
        <div className="text-center">
          {shop.name ? <p className="text-[17px] font-bold uppercase">{shop.name}</p> : null}
          {shop.address ? <p className="text-[12px] text-muted">{shop.address}</p> : null}
          {shop.phone ? <p className="text-[12px] text-muted">{shop.phone}</p> : null}
        </div>
      ) : null}

      <h2 className={`text-center text-[16px] font-bold tracking-wide ${hasShopHeader ? 'mt-3' : ''}`}>
        PHIẾU BÁN HÀNG
      </h2>

      <div className="mt-2 flex justify-between text-[12px] text-muted">
        <span>Số: {order.code}</span>
        <span>{format(order.soldAt, 'dd/MM/yyyy HH:mm')}</span>
      </div>
      <p className="mt-1 text-[13px]">
        Khách: <span className="font-semibold">{order.customerName}</span>
      </p>

      <table className="mt-3 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase text-muted">
            <th className="py-1 text-left font-semibold">Mặt hàng</th>
            <th className="py-1 text-right font-semibold">SL</th>
            <th className="py-1 text-right font-semibold">Đơn giá</th>
            <th className="py-1 text-right font-semibold">T.tiền</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="align-top">
              <td className="py-1 pr-2">
                {line.name}
                {line.unit ? <span className="text-muted"> ({line.unit})</span> : null}
              </td>
              <td className="money py-1 pl-1 text-right">{formatQty(line.qty)}</td>
              <td className="money py-1 pl-2 text-right">{formatAmount(line.unitPrice)}</td>
              <td className="money py-1 pl-2 text-right font-semibold">{formatAmount(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isLast ? (
        <>
          <div className="mt-3 border-t border-dashed border-line pt-2">
            {adjusted ? (
              <>
                <Row label="Hàng" value={formatVnd(order.subtotal)} />
                {order.discount > 0 ? <Row label="Giảm giá" value={`− ${formatVnd(order.discount)}`} /> : null}
                {order.surcharge > 0 ? <Row label="Phụ thu" value={`+ ${formatVnd(order.surcharge)}`} /> : null}
              </>
            ) : null}
            <Row label="Tổng cộng" value={formatVnd(order.total)} strong />
            {payments.map((payment) => (
              <Row key={payment.id} label={`Đã trả (${METHOD[payment.method]})`} value={formatVnd(payment.amount)} />
            ))}
            {remaining > 0 ? <Row label="Còn nợ" value={formatVnd(remaining)} strong /> : null}
          </div>

          {order.note ? (
            <p className="mt-3 border-t border-dashed border-line pt-2 text-[12px] text-muted">
              Ghi chú: {order.note}
            </p>
          ) : null}

          {shop.footerNote ? (
            <p className="mt-3 border-t border-dashed border-line pt-2 text-center text-[12px] text-muted">
              {shop.footerNote}
            </p>
          ) : null}
        </>
      ) : null}

      {pageCount > 1 ? (
        <p className="mt-3 border-t border-dashed border-line pt-2 text-center text-[12px] font-semibold text-muted">
          Trang {page}/{pageCount}
          {isLast ? '' : ' · còn tiếp'}
        </p>
      ) : null}
    </div>
  )
}
