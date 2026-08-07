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
      {lines.map((line) => (
        <li key={line.key} className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button
            type="button"
            onClick={() => onEdit(line)}
            className="min-w-0 flex-1 text-left"
            aria-label={`Sửa ${line.name}`}
          >
            <span className="block truncate text-[15px] font-semibold">{line.name}</span>
            <span className="block text-[13px] text-muted">
              {formatAmount(line.unitPrice)}
              {line.unit ? ` / ${line.unit}` : ''}
              {line.note ? ` · ${line.note}` : ''}
            </span>
          </button>

          <StepperButton label="−" onClick={() => onBump(line.key, -1)} />
          <span className="w-8 text-center text-[17px] font-bold tabular-nums">{formatQty(line.qty)}</span>
          <StepperButton label="+" onClick={() => onBump(line.key, 1)} />

          <span className="money w-20 shrink-0 text-right text-[15px] font-bold">
            {formatAmount(calcLineAmount(line))}
          </span>
        </li>
      ))}
    </ul>
  )
}
