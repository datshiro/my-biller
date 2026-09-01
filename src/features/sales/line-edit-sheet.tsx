import { useState } from 'react'
import { hasNoteToken, type CartLine } from '@/domain/cart'
import { parseQtyInput, formatQty } from '@/domain/money'
import { ICE, toggleIceToken } from './ice-note'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
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

        {/* Chip đứng TRÊN ô ghi chú vì nó ghi vào chính ô đó — người bán bấm rồi thấy chữ hiện ra
            ngay bên dưới, không phải đoán nó đi đâu. Không có state thứ hai: `note` là nguồn duy nhất. */}
        <div className="flex gap-2 overflow-x-auto">
          {ICE.map((token) => (
            <SelectChip
              key={token}
              selected={hasNoteToken(note, token)}
              onClick={() => setNote(toggleIceToken(note, token))}
            >
              {token}
            </SelectChip>
          ))}
        </div>

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
