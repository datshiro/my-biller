import { formatAmount } from '@/domain/money'
import type { Item } from '@/domain/schema'

export function ItemGrid({
  items,
  qtyOf,
  priceOf,
  hasMenu,
  onPick,
  onAdd,
}: {
  items: readonly Item[]
  /** Số lượng món này đang có trong giỏ, để làm nổi ô đã chọn. */
  qtyOf: (itemId: number) => number
  /**
   * Giá **sẽ thu** nếu chạm ô này ngay bây giờ. Ô hàng hiện `item.unitPrice` là hiện giá lẻ trong khi
   * đang bán sỉ: người bán đọc giá trên ô rồi mới quyết định bán, mà con số đó lại không phải giá vào giỏ.
   */
  priceOf: (item: Item) => number
  /** Món có thực đơn riêng: chạm vào là mở sheet chọn trước khi vào giỏ, nên ô phải báo trước điều đó. */
  hasMenu: (item: Item) => boolean
  onPick: (item: Item) => void
  onAdd: () => void
}) {
  return (
    <div role="group" aria-label="Mặt hàng" className="grid grid-cols-3 gap-2 px-4 pb-4">
      {items.map((item) => {
        const qty = item.id === undefined ? 0 : qtyOf(item.id)
        const price = priceOf(item)
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className={`relative flex min-h-[76px] flex-col justify-between rounded-btn border p-2 text-left active:scale-[0.98] ${
              qty > 0 ? 'border-brand bg-brand-tint' : 'border-line bg-surface'
            }`}
          >
            <span className="flex items-start gap-1">
              <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{item.name}</span>
              {item.pinned === 1 ? (
                <svg
                  role="img"
                  aria-label="Đã ghim"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ml-auto mt-0.5 size-3.5 shrink-0 text-brand"
                >
                  <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              ) : null}
            </span>
            <span className="flex items-center gap-1">
              <span className="money text-[15px] font-bold">{formatAmount(price)}</span>
              {price !== item.unitPrice ? (
                <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold uppercase text-white">
                  sỉ
                </span>
              ) : null}
              {hasMenu(item) ? (
                <svg
                  role="img"
                  aria-label="Có tuỳ chọn"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ml-auto size-3.5 shrink-0 text-faint"
                >
                  <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
                </svg>
              ) : null}
            </span>
            {qty > 0 ? (
              <span
                aria-label={`Đang có ${qty} trong giỏ`}
                className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-[13px] font-bold text-white"
              >
                {qty}
              </span>
            ) : null}
          </button>
        )
      })}

      {/* Cuối lưới, không phải đầu: mọi ô khác là một lượt bán, để lối rời màn lên đầu là mời chạm
          nhầm giữa lúc quán đông. Nét đứt viền `faint` chứ không `line`: `line` chỉ tương phản 1,3:1
          với nền trắng, tức dấu hiệu "không phải món" gần như vô hình. */}
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-btn border border-dashed border-faint p-2 text-[13px] font-semibold text-muted active:scale-[0.98]"
      >
        <span className="text-[20px] leading-none">＋</span>
        Thêm mặt hàng
      </button>
    </div>
  )
}
