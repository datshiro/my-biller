import { format } from 'date-fns'
import { labelDots, type LabelSize } from '@/domain/tspl/encode'
import type { Order, ShopSettings } from '@/domain/schema'

/**
 * DOM của một tem, 1px = 1 chấm máy in nên chụp ra đúng khổ. Không in tên món (tem chỉ để khớp ly với
 * đơn). Góc dưới phải để trống: số thứ tự `i/n` do máy in tự vẽ bằng font dựng sẵn.
 */
export function LabelView({
  shop,
  order,
  size,
  innerRef,
}: {
  shop: ShopSettings
  order: Order
  size: LabelSize
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const { width, height } = labelDots(size)
  const unit = height / 10

  return (
    <div
      ref={innerRef}
      data-label
      className="flex flex-col overflow-hidden bg-white leading-tight text-ink"
      style={{ width, height, padding: unit * 0.4 }}
    >
      {shop.name ? (
        <p className="truncate font-bold uppercase" style={{ fontSize: unit * 0.9 }}>
          {shop.name}
        </p>
      ) : null}
      {/* Không `truncate`: mã đơn là thứ duy nhất khớp ly với đơn, cắt đuôi "…A001" là tem vô dụng. */}
      <p className="font-bold break-all" style={{ fontSize: unit * 1.15 }}>
        {order.code}
      </p>
      <p style={{ fontSize: unit * 0.85 }}>{format(order.soldAt, 'HH:mm dd/MM')}</p>
      <p className="truncate font-semibold" style={{ fontSize: unit * 0.85, maxWidth: width * 0.6 }}>
        {order.customerName}
      </p>
    </div>
  )
}
