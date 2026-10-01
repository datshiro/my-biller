import { useState } from 'react'
import type { CartLine } from '@/domain/cart'
import { optionGroupsFor, orphanOptions, setToppingQty, toggleOption } from '@/domain/line-extras'
import { formatAmount, parseQtyInput, formatQty } from '@/domain/money'
import { calcUnitPriceWithToppings } from '@/domain/order-total'
import type { LineTopping, OptionGroup, ToppingMenuItem } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

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
  const stepper = 'h-11 w-11 shrink-0 rounded-btn border border-line bg-white text-[20px] font-bold leading-none active:bg-surface'
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{item.name}</span>
        <span className="money block text-[13px] text-muted">+ {formatAmount(price)}</span>
      </span>
      <button type="button" aria-label={`Bớt ${item.name}`} disabled={qty === 0} onClick={() => onChange(qty - 1)} className={stepper}>
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
        className={stepper}
      >
        +
      </button>
    </div>
  )
}

export function LineEditSheet({
  line,
  menu,
  onApply,
  onRemove,
  onClose,
}: {
  line: CartLine
  /** Thực đơn tuỳ chọn và topping của nhóm món chứa món này; `undefined` là món chưa phân nhóm. */
  menu: { optionGroups: readonly OptionGroup[]; toppingMenu: readonly ToppingMenuItem[] } | undefined
  onApply: (patch: {
    qty: number
    unitPrice: number
    options: string[]
    toppings: LineTopping[]
    note: string
  }) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [qtyText, setQtyText] = useState(() => formatQty(line.qty))
  const [unitPrice, setUnitPrice] = useState<number | null>(line.unitPrice)
  const [options, setOptions] = useState(line.options)
  const [toppings, setToppings] = useState(line.toppings)
  const [note, setNote] = useState(line.note)

  const qty = parseQtyInput(qtyText)
  const invalid = qty === null || unitPrice === null
  const groups = optionGroupsFor(menu)
  const stray = orphanOptions(options, groups)
  const toppingMenu = menu?.toppingMenu ?? []
  // Topping tính theo ly nên chỉ THÊM được khi số ly nguyên. Số lượng lẻ có thể đã gõ ở ô trong giỏ trên một
  // dòng có sẵn topping: những topping đó vẫn phải hiện và gỡ được, không được âm thầm bị bỏ khi bấm XONG
  // — bỏ là đổi tiền của dòng mà người bán không hay biết.
  const wholeCups = qty !== null && Number.isInteger(qty)
  const toppingNames = new Set(toppingMenu.map((item) => item.name))
  const strayToppings = toppings.filter((topping) => !toppingNames.has(topping.name))
  const shownToppings = wholeCups ? toppingMenu : toppingMenu.filter((item) => toppings.some((t) => t.name === item.name))

  return (
    <Sheet
      title={line.name}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="cta"
            disabled={invalid}
            onClick={() => {
              if (qty === null || unitPrice === null) return
              onApply({
                qty,
                unitPrice,
                options,
                toppings,
                note: note.trim(),
              })
            }}
          >
            XONG
          </Button>
          <Button variant="danger" onClick={onRemove}>
            Bỏ món này khỏi đơn
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Số lượng"
          value={qtyText}
          inputMode="decimal"
          onChange={(event) => setQtyText(event.target.value)}
          // `qty === null` giờ chỉ còn đúng một nghĩa: KHÔNG ĐỌC ĐƯỢC. `0` là số đọc được và có
          // nghĩa "bỏ món" — gõ 0 rồi XONG đi qua `updateLine`, cùng ngữ nghĩa với ô inline trong
          // giỏ. Câu cũ ("phải lớn hơn 0") chưa bao giờ đúng cho "abc" hay "1.000".
          error={qty === null ? 'Số lượng không đọc được. Gõ số, ví dụ 2 hoặc 0,5.' : undefined}
          hint={line.unit ? `Đơn vị: ${line.unit}` : undefined}
        />

        <MoneyInput
          label="Đơn giá riêng cho đơn này"
          value={unitPrice}
          onChange={setUnitPrice}
          error={unitPrice === null ? 'Nhập đơn giá.' : undefined}
          hint="Chỉ đổi trong đơn này. Giá trong danh mục giữ nguyên."
        />

        {/* Chip đứng TRÊN ô ghi chú vì chúng là thứ người bán chọn trước khi gõ thêm lời dặn của khách.
            Không có state thứ hai ngoài `options`/`toppings`: nhãn chip nằm thẳng trên dòng, không ghi
            ngầm vào ô ghi chú. */}
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-muted">{group.name}</span>
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
            <span className="text-[13px] font-semibold text-muted">Topping</span>
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

        <TextField
          label="Ghi chú"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ví dụ: mang về, gói kỹ"
        />
      </div>
    </Sheet>
  )
}
