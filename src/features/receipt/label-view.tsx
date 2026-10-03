import { format } from 'date-fns'
import { COUNTER_HEIGHT, counterBox, labelDots, type LabelSize } from '@/domain/tspl/encode'
import type { LabelBlock } from '@/domain/label-pages'
import type { Order, OrderLine, ShopSettings } from '@/domain/schema'
import { cornerLogoSide, labelBodyStyle, labelPadding, labelPaddingLeft, labelUnit } from './label-layout'

/**
 * DOM của một tem, 1px = 1 chấm máy in nên chụp ra đúng khổ. Một ly có ghi chú dài ra nhiều tem: mỗi tem
 * lặp lại phần đầu và tên món, `blocks` là phần thân của riêng tem đó. Hàng đáy chừa chỗ cho số thứ tự
 * `i/n` do máy in tự vẽ bằng font dựng sẵn, và mang dấu phụ trang `tr k/m` ở góc trái khi ly có nhiều tem.
 */
export function LabelView({
  shop,
  order,
  line,
  size,
  count,
  blocks,
  page,
  pageCount,
  cornerLogo = false,
  innerRef,
}: {
  shop: ShopSettings
  order: Order
  line: OrderLine
  size: LabelSize
  /** Tổng số ly của đơn — để chừa đủ chỗ cho số thứ tự dài nhất (`12/12`) ở góc dưới phải. */
  count: number
  blocks: readonly LabelBlock[]
  page: number
  pageCount: number
  /** Logo nhỏ ở góc trên phải (ghép sau khi chụp): hai dòng đầu tem chừa chỗ để chữ không chui dưới logo. */
  cornerLogo?: boolean
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const { width, height } = labelDots(size)
  const unit = labelUnit(size)
  const padding = labelPadding(size)
  const paddingLeft = labelPaddingLeft(size)

  const head = (
    <>
      {shop.name ? (
        <p className="truncate font-bold uppercase" style={{ fontSize: unit * 0.75 }}>
          {shop.name}
        </p>
      ) : null}
      {/* Không `truncate` mã đơn: nó là thứ khớp ly với đơn, cắt đuôi "…A001" là tem vô dụng. */}
      <p className="break-all" style={{ fontSize: unit * 0.75 }}>
        {order.code} · {format(order.soldAt, 'HH:mm dd/MM')}
      </p>
    </>
  )

  return (
    <div
      ref={innerRef}
      data-label
      className="flex flex-col overflow-hidden bg-white leading-tight text-ink"
      style={{ width, height, padding, paddingLeft }}
    >
      {cornerLogo ? (
        // Đầu tem cao ít nhất bằng logo góc, kể cả khi quán chưa đặt tên: tên món không được trồi lên dưới logo.
        <div
          data-label-head
          className="shrink-0"
          style={{ minHeight: cornerLogoSide(size), paddingRight: cornerLogoSide(size) + 4 }}
        >
          {head}
        </div>
      ) : (
        head
      )}
      <div style={{ borderTop: '2px solid currentColor', margin: `${unit * 0.15}px 0` }} />
      {/* Tên món to nhất: người pha nhìn tem biết ly nào là món gì. Dài thì xuống tối đa hai dòng. */}
      <p className="line-clamp-2 font-bold" style={{ fontSize: unit * 1.3 }}>
        {line.name}
      </p>
      <div data-label-body className="relative min-h-0 flex-1 overflow-hidden">
        {blocks.map((block) => (
          <p key={block.kind} style={labelBodyStyle(size, block.kind)}>
            {block.text}
          </p>
        ))}
      </div>
      <div className="flex items-end" style={{ height: COUNTER_HEIGHT }}>
        {pageCount > 1 ? (
          <p
            className="truncate font-semibold"
            style={{ fontSize: unit * 0.75, maxWidth: counterBox(size, count).x - paddingLeft - 4 }}
          >
            tr {page}/{pageCount}
          </p>
        ) : null}
      </div>
    </div>
  )
}
