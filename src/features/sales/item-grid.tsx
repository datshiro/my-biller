import { formatAmount } from '@/domain/money'
import type { Item } from '@/domain/schema'

export function ItemGrid({
  items,
  qtyOf,
  priceOf,
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
            <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{item.name}</span>
            <span className="flex items-baseline gap-1">
              <span className="money text-[15px] font-bold">{formatAmount(price)}</span>
              {price !== item.unitPrice ? (
                <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold uppercase text-white">
                  sỉ
                </span>
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
