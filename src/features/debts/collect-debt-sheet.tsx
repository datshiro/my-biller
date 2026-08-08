import { useEffect, useRef, useState } from 'react'
import { collectDebt } from '@/db/repositories/payments'
import { formatVnd } from '@/domain/money'
import type { Payment } from '@/domain/schema'
import { Button } from '@/ui/button'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'
import { useSubmitOnce } from '@/ui/use-submit-once'

type Method = Payment['method']

const METHODS: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'transfer', label: 'Chuyển khoản' },
]

export function CollectDebtSheet({
  customerId,
  name,
  owed,
  onDone,
  onClose,
}: {
  customerId: number
  name: string
  owed: number
  onDone: () => void
  onClose: () => void
}) {
  const amountInput = useRef<HTMLInputElement>(null)
  const [amount, setAmount] = useState<number | null>(owed)
  const [method, setMethod] = useState<Method>('cash')
  const { submitting: saving, error, run } = useSubmitOnce('Không thu được.')

  useEffect(() => amountInput.current?.focus(), [])

  const taken = amount ?? 0
  const tooMuch = taken > owed
  const left = owed - taken

  const save = () => {
    if (taken <= 0 || tooMuch) return
    // Đọc đồng hồ tại lúc bấm: `now` của query có thể đã cũ hàng tiếng và phiếu thu sẽ rơi nhầm ngày.
    void run(async () => {
      await collectDebt({ customerId, amount: taken, method, paidAt: Date.now(), note: '' })
      onDone()
    })
  }

  return (
    <Sheet
      title={`Thu nợ · ${name}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-[15px] font-semibold text-danger">{error}</p> : null}
          <Button size="cta" disabled={saving || taken <= 0 || tooMuch} onClick={save}>
            {saving ? 'Đang lưu…' : `THU ${formatVnd(taken)}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-btn bg-warn-tint p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] text-muted">Đang nợ</span>
            <span className="money text-[20px] font-bold text-warn">{formatVnd(owed)}</span>
          </div>
        </div>

        <MoneyInput
          label="Thu bao nhiêu"
          value={amount}
          onChange={setAmount}
          inputRef={amountInput}
          large
          quickAdd
          error={tooMuch ? `Khách chỉ còn nợ ${formatVnd(owed)}.` : undefined}
        />

        <button
          type="button"
          onClick={() => setAmount(owed)}
          className="h-12 rounded-btn border border-line bg-white font-semibold active:bg-surface"
        >
          Trả hết
        </button>

        <div role="group" aria-label="Hình thức thu" className="flex gap-2">
          {METHODS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={method === option.value}
              onClick={() => setMethod(option.value)}
              className={`h-12 flex-1 rounded-btn border text-[15px] font-semibold ${
                method === option.value ? 'border-brand bg-brand text-white' : 'border-line bg-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Con số người bán thật sự cần trước khi bấm: thu xong thì khách này còn nợ bao nhiêu. */}
        {!tooMuch ? (
          <div className="flex items-baseline justify-between rounded-btn bg-surface p-4">
            <span className="text-[15px] font-semibold">Còn nợ sau khi thu</span>
            <span className={`money text-[20px] font-bold ${left > 0 ? 'text-warn' : 'text-brand'}`}>
              {left > 0 ? formatVnd(left) : 'Hết nợ'}
            </span>
          </div>
        ) : null}

        <p className="text-[13px] text-muted">
          Tiền thu trừ vào đơn cũ nhất trước. Mỗi lần thu là một dòng riêng trong lịch sử.
        </p>
      </div>
    </Sheet>
  )
}
