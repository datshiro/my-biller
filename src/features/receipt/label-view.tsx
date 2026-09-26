import { format } from 'date-fns'
import { labelDots, type LabelSize } from '@/domain/tspl/encode'
import type { Order, OrderLine, ShopSettings } from '@/domain/schema'

/**
 * DOM của tem cho một món, 1px = 1 chấm máy in nên chụp ra đúng khổ. Mọi phần của món này dùng chung
 * ảnh. Góc dưới phải để trống: số thứ tự `i/n` do máy in tự vẽ bằng font dựng sẵn.
 */
export function LabelView({
  shop,
  order,
  line,
  size,
  innerRef,
}: {
  shop: ShopSettings
  order: Order
  line: OrderLine
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
        <p className="truncate font-bold uppercase" style={{ fontSize: unit * 0.75 }}>
          {shop.name}
        </p>
      ) : null}
      {/* Không `truncate` mã đơn: nó là thứ khớp ly với đơn, cắt đuôi "…A001" là tem vô dụng. */}
      <p className="break-all" style={{ fontSize: unit * 0.75 }}>
        {order.code} · {format(order.soldAt, 'HH:mm dd/MM')}
      </p>
      {/* Tên món to nhất: người pha nhìn tem biết ly nào là món gì. Dài thì xuống tối đa hai dòng. */}
      <p className="line-clamp-2 font-bold" style={{ fontSize: unit * 1.3, marginTop: unit * 0.2 }}>
        {line.name}
      </p>
      {line.note ? (
        <p className="line-clamp-2" style={{ fontSize: unit * 0.8 }}>
          {line.note}
        </p>
      ) : null}
      <p className="mt-auto truncate font-semibold" style={{ fontSize: unit * 0.75, maxWidth: width * 0.55 }}>
        {order.customerName}
      </p>
    </div>
  )
}
