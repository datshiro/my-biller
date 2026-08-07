import { useState } from 'react'
import { format, subDays } from 'date-fns'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

export type Range = { from: string; to: string }

/**
 * Khoảng ngày tự chọn. Ngày ở dạng `yyyy-MM-dd` nên so sánh chuỗi cũng ra đúng thứ tự — không cần
 * dựng `Date` chỉ để biết ngày nào trước.
 */
export function RangeSheet({
  now,
  initial,
  onApply,
  onClose,
}: {
  now: number
  initial: Range | null
  onApply: (range: Range) => void
  onClose: () => void
}) {
  const today = format(now, 'yyyy-MM-dd')
  const [from, setFrom] = useState(initial?.from ?? format(subDays(now, 6), 'yyyy-MM-dd'))
  const [to, setTo] = useState(initial?.to ?? today)

  const backwards = from > to

  return (
    <Sheet
      title="Chọn khoảng ngày"
      onClose={onClose}
      footer={
        <Button size="cta" disabled={backwards} onClick={() => onApply({ from, to })}>
          XEM BÁO CÁO
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Từ ngày"
          type="date"
          value={from}
          max={today}
          onChange={(event) => {
            if (event.target.value) setFrom(event.target.value)
          }}
          error={backwards ? 'Ngày đầu đang sau ngày cuối.' : undefined}
        />
        <TextField
          label="Đến ngày"
          type="date"
          value={to}
          max={today}
          onChange={(event) => {
            if (event.target.value) setTo(event.target.value)
          }}
        />
      </div>
    </Sheet>
  )
}
