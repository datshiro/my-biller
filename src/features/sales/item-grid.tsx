import { formatAmount } from '@/domain/money'
import type { Item } from '@/domain/schema'

export function ItemGrid({
  items,
  qtyOf,
  onPick,
}: {
  items: readonly Item[]
  /** Số lượng món này đang có trong giỏ, để làm nổi ô đã chọn. */
  qtyOf: (itemId: number) => number
  onPick: (item: Item) => void
}) {
  return (
    <div role="group" aria-label="Mặt hàng" className="grid grid-cols-3 gap-2 px-4 pb-4">
      {items.map((item) => {
        const qty = item.id === undefined ? 0 : qtyOf(item.id)
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
            <span className="money text-[15px] font-bold">{formatAmount(item.unitPrice)}</span>
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
    </div>
  )
}
