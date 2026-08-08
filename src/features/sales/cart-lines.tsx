import { calcLineAmount } from '@/domain/order-total'
import { formatAmount, formatQty } from '@/domain/money'
import type { CartLine } from '@/domain/cart'

function StepperButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label === '−' ? 'Bớt một' : 'Thêm một'}
      onClick={onClick}
      className="h-11 w-11 shrink-0 rounded-btn border border-line bg-white text-[20px] font-bold leading-none active:bg-surface"
    >
      {label}
    </button>
  )
}

export function CartLines({
  lines,
  onBump,
  onEdit,
}: {
  lines: readonly CartLine[]
  onBump: (key: string, delta: number) => void
  onEdit: (line: CartLine) => void
}) {
  return (
    <ul className="border-t border-line">
      {/* Tên đứng riêng một dòng: xếp cùng hàng với hai nút ±, ô số lượng và ô thành tiền thì trên
          máy 320px tên chỉ còn ~56px, "Phở bò tái nạm" và "Phở bò tái gầu" đều hiện thành "Phở b…". */}
      {lines.map((line) => (
        <li key={line.key} className="flex flex-col gap-1 border-b border-line px-4 py-2">
          <button
            type="button"
            onClick={() => onEdit(line)}
            className="w-full min-w-0 text-left"
            aria-label={`Sửa ${line.name}`}
          >
            <span className="block text-[15px] font-semibold">{line.name}</span>
            <span className="block text-[13px] text-muted">
              {formatAmount(line.unitPrice)}
              {line.unit ? ` / ${line.unit}` : ''}
              {line.note ? ` · ${line.note}` : ''}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <StepperButton label="−" onClick={() => onBump(line.key, -1)} />
            <span className="w-8 text-center text-[17px] font-bold tabular-nums">{formatQty(line.qty)}</span>
            <StepperButton label="+" onClick={() => onBump(line.key, 1)} />

            <span className="money flex-1 text-right text-[15px] font-bold">
              {formatAmount(calcLineAmount(line))}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
