import { useState } from 'react'
import type { CartLine } from '@/domain/cart'
import { parseQtyInput, formatQty } from '@/domain/money'
import { Button } from '@/ui/button'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

export function LineEditSheet({
  line,
  onApply,
  onRemove,
  onClose,
}: {
  line: CartLine
  onApply: (patch: { qty: number; unitPrice: number; note: string }) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [qtyText, setQtyText] = useState(() => formatQty(line.qty))
  const [unitPrice, setUnitPrice] = useState<number | null>(line.unitPrice)
  const [note, setNote] = useState(line.note)

  const qty = parseQtyInput(qtyText)
  const invalid = qty === null || unitPrice === null

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
              onApply({ qty, unitPrice, note: note.trim() })
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
          error={qty === null ? 'Số lượng phải lớn hơn 0.' : undefined}
          hint={line.unit ? `Đơn vị: ${line.unit}` : undefined}
        />

        <MoneyInput
          label="Đơn giá riêng cho đơn này"
          value={unitPrice}
          onChange={setUnitPrice}
          error={unitPrice === null ? 'Nhập đơn giá.' : undefined}
          hint="Chỉ đổi trong đơn này. Giá trong danh mục giữ nguyên."
        />

        <TextField
          label="Ghi chú"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ví dụ: ít đường, mang về"
        />
      </div>
    </Sheet>
  )
}
