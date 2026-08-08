import { useEffect, useRef, useState } from 'react'
import { endOfDay, format, getDate, getMonth, getYear, parseISO } from 'date-fns'
import { createExpense, deleteExpense, updateExpense } from '@/db/repositories/expenses'
import type { Expense, ExpenseCategory } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { MoneyInput } from '@/ui/money-input'
import { Sheet } from '@/ui/sheet'
import { Field, TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

/**
 * Đổi ngày nhưng giữ nguyên giờ phút của khoản chi: ghi lúc 23:50 rồi sửa sang hôm qua thì vẫn là
 * 23:50 hôm qua. Dựng `Date` bằng các thành phần địa phương thay vì `set()` để tránh tràn ngày
 * (31/8 đổi sang tháng 2 sẽ nhảy sang tháng 3 nếu đặt tháng trước rồi mới đặt ngày).
 */
function withDate(base: number, isoDate: string): number {
  const day = parseISO(isoDate)
  const at = new Date(base)
  return new Date(
    getYear(day),
    getMonth(day),
    getDate(day),
    at.getHours(),
    at.getMinutes(),
    at.getSeconds(),
    at.getMilliseconds(),
  ).getTime()
}

export function ExpenseSheet({
  expense,
  categories,
  now,
  onClose,
}: {
  /** `null` = ghi khoản mới. */
  expense: Expense | null
  categories: readonly ExpenseCategory[]
  now: number
  onClose: () => void
}) {
  const amountInput = useRef<HTMLInputElement>(null)
  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null)
  const [categoryId, setCategoryId] = useState<number | null>(expense?.categoryId ?? null)
  const [note, setNote] = useState(expense?.note ?? '')
  /** `null` = người bán chưa đụng vào ô ngày, cứ lấy theo đồng hồ. */
  const [spentAt, setSpentAt] = useState<number | null>(expense?.spentAt ?? null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { submitting, error, run } = useSubmitOnce('Không lưu được khoản chi. Thử lại.')

  // Sheet tự đưa focus vào khung của nó khi mở; effect của component cha chạy sau nên giành lại được.
  useEffect(() => amountInput.current?.focus(), [])

  const shownSpentAt = spentAt ?? now
  const inFuture = shownSpentAt > endOfDay(now).getTime()
  const canSave = amount !== null && amount > 0 && !inFuture

  const save = () => {
    if (!canSave) return
    void run(async () => {
      // Mốc ghi vào DB đọc tại đúng lúc bấm lưu: ghi lúc 00:10 phải là 00:10 hôm nay, không phải
      // giờ lúc mở tab.
      const input = { categoryId, amount, note: note.trim(), spentAt: spentAt ?? Date.now() }
      if (expense?.id === undefined) await createExpense(input)
      else await updateExpense(expense.id, input)
      onClose()
    })
  }

  const remove = () =>
    void run(async () => {
      if (expense?.id !== undefined) await deleteExpense(expense.id)
      onClose()
    })

  return (
    <>
      <Sheet
        title={expense ? 'Sửa khoản chi' : 'Ghi chi phí'}
        onClose={onClose}
        footer={
          <div className="flex flex-col gap-2">
            {error ? <p className="text-[15px] font-semibold text-danger">{error}</p> : null}
            <div className="flex gap-3">
              {/* Không đặt tên là "Xoá": hàng nút nhanh của ô tiền đã có một nút "Xoá" để xoá trắng
                  số đang gõ, hai nút cùng tên cạnh nhau mà một cái làm mất hẳn khoản chi thì quá dễ nhầm. */}
              {expense ? (
                <Button
                  variant="danger"
                  className="h-14 shrink-0 whitespace-nowrap"
                  onClick={() => setConfirmDelete(true)}
                >
                  Xoá khoản chi
                </Button>
              ) : null}
              <Button size="cta" disabled={!canSave || submitting} onClick={save}>
                {submitting ? 'Đang lưu…' : 'LƯU'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <MoneyInput
            label="Số tiền"
            value={amount}
            onChange={setAmount}
            inputRef={amountInput}
            large
            quickAdd
          />

          <Field label="Loại">
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <SelectChip
                  key={category.id}
                  selected={categoryId === category.id}
                  onClick={() => setCategoryId(category.id ?? null)}
                >
                  {category.name}
                </SelectChip>
              ))}
            </div>
          </Field>

          <TextField
            label="Ghi chú"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Mua gì, ở đâu…"
          />

          <TextField
            label="Ngày chi"
            type="date"
            value={format(shownSpentAt, 'yyyy-MM-dd')}
            max={format(now, 'yyyy-MM-dd')}
            onChange={(event) => {
              if (event.target.value) setSpentAt(withDate(shownSpentAt, event.target.value))
            }}
            error={inFuture ? 'Chưa tới ngày đó, không ghi trước được.' : undefined}
          />
        </div>
      </Sheet>

      {confirmDelete ? (
        <ConfirmDialog
          title="Xoá khoản chi?"
          message="Khoản chi này sẽ biến mất khỏi tổng chi của tháng."
          confirmLabel="Xoá"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  )
}
