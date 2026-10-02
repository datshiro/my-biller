import { useEffect, useId, useState } from 'react'
import type { CartLine } from '@/domain/cart'
import {
  hasNotePhrase,
  optionGroupsFor,
  orphanOptions,
  recentNotePhrases,
  setToppingQty,
  toggleNotePhrase,
  toggleOption,
} from '@/domain/line-extras'
import { formatAmount, parseQtyInput, formatQty } from '@/domain/money'
import { calcLineAmount, calcUnitPriceWithToppings } from '@/domain/order-total'
import type { LineTopping, OptionGroup, ToppingMenuItem } from '@/domain/schema'
import { listRecentLineNotes } from '@/db/repositories/orders'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'

/** Đủ để thấy thói quen của quán mà không quét cả bảng dòng hàng mỗi lần mở sheet. */
const RECENT_LINES = 300
const NOTE_CHIPS = 6

const STEPPER =
  'h-11 w-11 shrink-0 rounded-btn border border-line bg-white text-[20px] font-bold leading-none active:bg-surface disabled:opacity-40'

function ToppingRow({
  item,
  chosen,
  canAdd,
  onChange,
}: {
  item: ToppingMenuItem
  chosen: LineTopping | undefined
  canAdd: boolean
  onChange: (qty: number) => void
}) {
  const qty = chosen?.qty ?? 0
  const price = chosen?.unitPrice ?? item.price
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{item.name}</span>
        <span className="money block text-[13px] text-muted">+ {formatAmount(price)}</span>
      </span>
      <button type="button" aria-label={`Bớt ${item.name}`} disabled={qty === 0} onClick={() => onChange(qty - 1)} className={STEPPER}>
        −
      </button>
      <span aria-label={`Số phần ${item.name}`} className="w-6 shrink-0 text-center text-[17px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        aria-label={`Thêm ${item.name}`}
        disabled={!canAdd}
        onClick={() => onChange(qty + 1)}
        className={STEPPER}
      >
        +
      </button>
    </div>
  )
}

/** Nguồn của đơn giá đang hiện, để người bán biết bấm "Đổi giá" là đổi cái gì. Ngắn để vừa một dòng ở 320px. */
const priceOrigin = (line: CartLine) => {
  if (line.priceSource === 'manual') return 'giá riêng'
  return line.unitPrice === line.retailPrice ? 'danh mục' : 'giá sỉ'
}

/**
 * Sheet của một dòng hàng, dùng cho cả hai lúc: THÊM (chạm món có thực đơn riêng) và SỬA (chạm dòng trong
 * đơn). Tuỳ chọn, topping và ghi chú đứng trước vì đó là thứ hay chọn; đơn giá riêng hiếm dùng nên nằm sau
 * nút "Đổi giá". Lúc thêm, số lượng nằm ở chân sheet cạnh nút THÊM; lúc sửa, nằm đầu sheet vì gõ được số lẻ.
 */
export function LineEditSheet({
  line,
  menu,
  mode = 'edit',
  subtitle,
  onApply,
  onRemove,
  onClose,
}: {
  line: CartLine
  /** Thực đơn tuỳ chọn và topping của nhóm món chứa món này; `undefined` là món chưa phân nhóm. */
  menu: { optionGroups: readonly OptionGroup[]; toppingMenu: readonly ToppingMenuItem[] } | undefined
  mode?: 'add' | 'edit'
  subtitle?: string
  onApply: (patch: {
    qty: number
    unitPrice: number
    options: string[]
    toppings: LineTopping[]
    note: string
  }) => void
  onRemove?: () => void
  onClose: () => void
}) {
  const adding = mode === 'add'
  const qtyId = useId()
  const noteId = useId()
  const [qtyText, setQtyText] = useState(() => formatQty(line.qty))
  const [editedPrice, setUnitPrice] = useState<number | null>(line.unitPrice)
  // Sheet thêm không sửa được giá và có thể mở ngay lúc bảng giá SỈ còn đang về: đọc giá từ prop mỗi lần
  // vẽ, chụp lại lúc mở thì nút THÊM hiện một số mà sổ ghi số khác.
  const unitPrice = adding ? line.unitPrice : editedPrice
  const [priceOpen, setPriceOpen] = useState(false)
  const [options, setOptions] = useState(line.options)
  const [toppings, setToppings] = useState(line.toppings)
  const [note, setNote] = useState(line.note)
  const [recentNotes, setRecentNotes] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    listRecentLineNotes(RECENT_LINES)
      .then((notes) => {
        if (alive) setRecentNotes(notes)
      })
      // Không có chip gợi ý thì người bán vẫn gõ được ghi chú; không đáng chặn sheet vì lượt đọc này.
      .catch((caught: unknown) => console.error('Không đọc được ghi chú gần đây:', caught))
    return () => {
      alive = false
    }
  }, [])

  const qty = parseQtyInput(qtyText)
  const invalid = qty === null || unitPrice === null || (adding && qty <= 0)
  const groups = optionGroupsFor(menu)
  const recent = recentNotePhrases(recentNotes, NOTE_CHIPS, groups.flatMap((group) => group.choices))
  const stray = orphanOptions(options, groups)
  const toppingMenu = menu?.toppingMenu ?? []
  // Topping tính theo ly nên chỉ THÊM được khi số ly nguyên. Số lượng lẻ có thể đã gõ ở ô trong giỏ trên một
  // dòng có sẵn topping: những topping đó vẫn phải hiện và gỡ được, không được âm thầm bị bỏ khi bấm XONG
  // — bỏ là đổi tiền của dòng mà người bán không hay biết.
  const wholeCups = qty !== null && Number.isInteger(qty)
  const toppingNames = new Set(toppingMenu.map((item) => item.name))
  const strayToppings = toppings.filter((topping) => !toppingNames.has(topping.name))
  const shownToppings = wholeCups ? toppingMenu : toppingMenu.filter((item) => toppings.some((t) => t.name === item.name))

  // Làm tròn sau phép cộng: 1,3 − 1 ra 0,30000000000000004, ô sẽ báo "không đọc được" cho số người bán không gõ.
  const bump = (delta: number) =>
    setQtyText(formatQty(Math.max(adding ? 1 : 0, Math.round(((qty ?? line.qty) + delta) * 1000) / 1000)))

  const apply = () => {
    if (qty === null || unitPrice === null) return
    onApply({ qty, unitPrice, options, toppings, note: note.trim() })
  }

  const amount =
    qty !== null && qty > 0 && unitPrice !== null ? calcLineAmount({ unitPrice, qty, toppings }) : null

  return (
    <Sheet
      title={line.name}
      onClose={onClose}
      footer={
        adding ? (
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Bớt một" disabled={(qty ?? 1) <= 1} onClick={() => bump(-1)} className={STEPPER}>
              −
            </button>
            <span aria-label="Số lượng" className="w-8 shrink-0 text-center text-[17px] font-bold tabular-nums">
              {qtyText}
            </span>
            <button type="button" aria-label="Thêm một" onClick={() => bump(1)} className={STEPPER}>
              +
            </button>
            <Button size="cta" className="flex-1" disabled={invalid} onClick={apply}>
              THÊM{amount !== null ? ` · ${formatAmount(amount)}` : ''}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="danger" className="shrink-0" onClick={onRemove}>
              Bỏ món
            </Button>
            <Button size="cta" className="flex-1" disabled={invalid} onClick={apply}>
              XONG
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {subtitle ? <p className="-mt-2 text-[13px] text-muted">{subtitle}</p> : null}

        {adding ? null : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={qtyId} className="label-xs text-muted">
                Số lượng
              </label>
              <span className="flex items-center gap-2">
                <button type="button" aria-label="Bớt một" onClick={() => bump(-1)} className={STEPPER}>
                  −
                </button>
                <input
                  id={qtyId}
                  type="text"
                  inputMode="decimal"
                  value={qtyText}
                  onChange={(event) => setQtyText(event.target.value)}
                  aria-invalid={qty === null ? true : undefined}
                  className={`h-11 w-16 shrink-0 rounded-btn border bg-surface text-center text-[17px] font-bold tabular-nums outline-none focus:border-brand ${
                    qty === null ? 'border-danger' : 'border-line'
                  }`}
                />
                <button type="button" aria-label="Thêm một" onClick={() => bump(1)} className={STEPPER}>
                  +
                </button>
              </span>
            </div>
            {/* `qty === null` chỉ có một nghĩa: KHÔNG ĐỌC ĐƯỢC. `0` đọc được và có nghĩa "bỏ món", cùng ngữ
                nghĩa với ô số lượng trong giỏ. */}
            {qty === null ? (
              <p className="text-[13px] font-semibold text-danger">Số lượng không đọc được. Gõ số, ví dụ 2 hoặc 0,5.</p>
            ) : line.unit ? (
              <p className="text-right text-[13px] text-muted">Đơn vị: {line.unit}</p>
            ) : null}
          </div>
        )}

        {/* Không có state thứ hai ngoài `options`/`toppings`: nhãn chip nằm thẳng trên dòng, không ghi
            ngầm vào ô ghi chú. */}
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-1.5">
            <span className="label-xs text-muted">{group.name}</span>
            <div className="flex gap-2 overflow-x-auto">
              {group.choices.map((choice) => (
                <SelectChip
                  key={choice}
                  selected={options.includes(choice)}
                  onClick={() => setOptions(toggleOption(options, group, choice))}
                >
                  {choice}
                </SelectChip>
              ))}
            </div>
          </div>
        ))}
        {stray.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto">
            {stray.map((option) => (
              <SelectChip key={option} selected onClick={() => setOptions(options.filter((o) => o !== option))}>
                {option}
              </SelectChip>
            ))}
          </div>
        ) : null}

        {shownToppings.length > 0 || strayToppings.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="label-xs text-muted">Topping</span>
            {!wholeCups ? (
              <span className="text-[13px] text-muted">Số lượng lẻ: chỉ bớt được topping, không thêm.</span>
            ) : null}
            {[...shownToppings, ...strayToppings.map((t) => ({ name: t.name, price: t.unitPrice }))].map((item) => (
              <ToppingRow
                key={item.name}
                item={item}
                canAdd={wholeCups}
                chosen={toppings.find((topping) => topping.name === item.name)}
                onChange={(next) => setToppings(setToppingQty(toppings, item, next))}
              />
            ))}
            {toppings.length > 0 && unitPrice !== null ? (
              <span className="money text-[13px] text-muted">
                Mỗi ly: {formatAmount(calcUnitPriceWithToppings({ unitPrice, toppings }))}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="label-xs text-muted">
            Ghi chú
          </label>
          {recent.length > 0 ? (
            <div role="group" aria-label="Ghi chú gần đây" className="flex flex-wrap gap-2">
              {recent.map((phrase) => (
                <SelectChip
                  key={phrase}
                  selected={hasNotePhrase(note, phrase)}
                  onClick={() => setNote(toggleNotePhrase(note, phrase))}
                >
                  {phrase}
                </SelectChip>
              ))}
            </div>
          ) : null}
          <input
            id={noteId}
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={recent.length > 0 ? 'Lời dặn khác…' : 'Ví dụ: mang về, gói kỹ'}
            className="h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none placeholder:text-muted focus:border-brand"
          />
        </div>

        {adding ? null : priceOpen ? (
          <MoneyInput
            label="Đơn giá riêng cho đơn này"
            value={unitPrice}
            onChange={setUnitPrice}
            error={unitPrice === null ? 'Nhập đơn giá.' : undefined}
            hint="Chỉ đổi trong đơn này. Giá trong danh mục giữ nguyên."
          />
        ) : (
          <button
            type="button"
            onClick={() => setPriceOpen(true)}
            className="flex h-12 items-center justify-between gap-3 rounded-btn border border-line px-3 text-left"
          >
            <span className="min-w-0 truncate">
              <span className="money font-semibold">{formatAmount(line.unitPrice)}</span>
              <span className="text-muted">
                {line.unit ? ` / ${line.unit}` : ''} · {priceOrigin(line)}
              </span>
            </span>
            <span className="shrink-0 font-semibold text-brand">Đổi giá ›</span>
          </button>
        )}
      </div>
    </Sheet>
  )
}
