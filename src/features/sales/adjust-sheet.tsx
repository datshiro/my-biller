import { useState } from 'react'
import { formatVnd } from '@/domain/money'
import { Button } from '@/ui/button'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'

export function AdjustSheet({
  subtotal,
  discount,
  surcharge,
  onApply,
  onClose,
}: {
  subtotal: number
  discount: number
  surcharge: number
  onApply: (next: { discount: number; surcharge: number }) => void
  onClose: () => void
}) {
  const [nextDiscount, setNextDiscount] = useState<number | null>(discount || null)
  const [nextSurcharge, setNextSurcharge] = useState<number | null>(surcharge || null)

  const tooBig = (nextDiscount ?? 0) > subtotal

  return (
    <Sheet
      title="Giảm giá / phụ thu"
      onClose={onClose}
      footer={
        <Button
          size="cta"
          disabled={tooBig}
          onClick={() => onApply({ discount: nextDiscount ?? 0, surcharge: nextSurcharge ?? 0 })}
        >
          ÁP DỤNG
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-muted">Tiền hàng {formatVnd(subtotal)}</p>

        <MoneyInput
          label="Giảm giá"
          value={nextDiscount}
          onChange={setNextDiscount}
          quickAdd
          error={tooBig ? 'Giảm giá không được lớn hơn tiền hàng.' : undefined}
        />

        <MoneyInput label="Phụ thu" value={nextSurcharge} onChange={setNextSurcharge} quickAdd />
      </div>
    </Sheet>
  )
}
