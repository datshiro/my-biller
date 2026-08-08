import { calcChange, suggestCashAmounts } from '@/domain/cash-suggestion'
import { formatAmount, formatVnd } from '@/domain/money'
import type { Payment } from '@/domain/schema'
import { Button } from '@/ui/button'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'

export type PaymentChoice = Pick<Payment, 'amount' | 'method' | 'note'> | null

export type PayMethod = 'cash' | 'transfer' | 'debt'

const METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'transfer', label: 'Chuyển khoản' },
  { value: 'debt', label: 'Bán nợ' },
]

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={strong ? 'text-[15px] font-semibold' : 'text-[15px] text-muted'}>{label}</span>
      <span className={`money ${strong ? 'text-[20px] font-bold' : 'text-[17px] font-semibold'}`}>{value}</span>
    </div>
  )
}

/**
 * `method` và `given` do màn ngoài giữ, không phải state trong đây: ghi nợ phải đi chọn khách, mà
 * lúc đó sheet này bị gỡ khỏi cây. Nếu để state ở đây thì quay lại nó về mặc định "tiền mặt, đưa đủ"
 * và đơn nợ bị ghi thành đã thu đủ.
 */
export function PaymentSheet({
  total,
  hasCustomer,
  method,
  given,
  onMethodChange,
  onGivenChange,
  onConfirm,
  onPickCustomer,
  onClose,
  submitting,
  error,
}: {
  total: number
  hasCustomer: boolean
  method: PayMethod
  given: number | null
  onMethodChange: (method: PayMethod) => void
  onGivenChange: (given: number | null) => void
  onConfirm: (payment: PaymentChoice) => void
  onPickCustomer: () => void
  onClose: () => void
  submitting: boolean
  error: string | null
}) {
  const paid = method === 'debt' ? 0 : method === 'transfer' ? total : Math.min(given ?? 0, total)
  const owed = total - paid
  const change = method === 'cash' ? calcChange(total, given ?? 0) : 0
  const needsCustomer = owed > 0 && !hasCustomer

  const confirm = () =>
    onConfirm(paid > 0 ? { amount: paid, method: method === 'debt' ? 'cash' : method, note: '' } : null)

  return (
    <Sheet
      title="Thu tiền"
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[15px] font-semibold text-danger">{error}</p> : null}
          {needsCustomer ? (
            <Button size="cta" variant="secondary" onClick={onPickCustomer}>
              CHỌN KHÁCH ĐỂ GHI NỢ
            </Button>
          ) : (
            <Button size="cta" disabled={submitting} onClick={confirm}>
              {submitting ? 'Đang lưu…' : 'XONG & XUẤT PHIẾU'}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Hình thức thanh toán" className="flex gap-2">
          {METHODS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={method === option.value}
              onClick={() => {
                onMethodChange(option.value)
                if (option.value === 'cash') onGivenChange(total)
              }}
              className={`min-h-12 flex-1 rounded-btn border px-1 text-[15px] font-semibold leading-tight ${
                method === option.value ? 'border-brand bg-brand text-white' : 'border-line bg-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="rounded-btn bg-surface p-4">
          <Row label="Tổng đơn" value={formatVnd(total)} strong />
        </div>

        {method === 'cash' ? (
          <>
            <MoneyInput label="Khách đưa" value={given} onChange={onGivenChange} large />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onGivenChange(total)}
                className="h-12 flex-1 rounded-btn border border-line bg-white px-2 font-semibold active:bg-surface"
              >
                Đủ tiền
              </button>
              {suggestCashAmounts(total).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => onGivenChange(amount)}
                  className="money h-12 flex-1 rounded-btn border border-line bg-white px-2 font-semibold active:bg-surface"
                >
                  {formatAmount(amount)}
                </button>
              ))}
            </div>

            {change > 0 ? (
              <div className="rounded-btn border-2 border-brand bg-brand-tint p-4">
                <Row label="Tiền thối" value={formatVnd(change)} strong />
              </div>
            ) : null}
          </>
        ) : null}

        {method === 'transfer' ? (
          <p className="text-[15px] text-muted">Coi như khách đã chuyển đủ {formatVnd(total)}.</p>
        ) : null}

        {owed > 0 ? (
          <div className="rounded-btn border-2 border-warn bg-warn-tint p-4">
            <Row label={method === 'debt' ? 'Ghi nợ toàn bộ' : 'Còn nợ lại'} value={formatVnd(owed)} strong />
            <p className="mt-2 text-[13px] text-muted">
              {hasCustomer
                ? 'Khoản này sẽ vào công nợ của khách.'
                : 'Nợ phải có chủ — chọn khách thì mới ghi nợ được.'}
            </p>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
