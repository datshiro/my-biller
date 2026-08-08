import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ExpenseSheet } from './expense-sheet'
import { useExpenseCategories, useExpenseMonth } from './use-expenses'
import { ensureDefaultExpenseCategories } from '@/db/repositories/expenses'
import { formatAmount } from '@/domain/money'
import type { Expense } from '@/domain/schema'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { MonthPicker } from '@/ui/month-picker'
import { ScreenHeader } from '@/ui/screen-header'

/**
 * Dấu trừ toán học (U+2212), không phải gạch nối — nhìn ra ngay là số âm ở cỡ chữ nhỏ.
 * Không chi đồng nào thì viết `0`: "−0" chẳng có nghĩa gì.
 */
const minus = (amount: number) => (amount === 0 ? '0' : `−${formatAmount(amount)}`)

function TotalBox({ label, amount }: { label: string; amount: number | undefined }) {
  return (
    <div className="rounded-card bg-surface px-3 py-2">
      <span className="label-xs block text-muted">{label}</span>
      <span className="money block text-[22px] font-bold text-danger">
        {amount === undefined ? '…' : minus(amount)}
      </span>
    </div>
  )
}

export function ExpenseListPage() {
  const [monthOffset, setMonthOffset] = useState(0)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Expense | null | undefined>(undefined)

  const month = useExpenseMonth(monthOffset, categoryId)
  const categories = useExpenseCategories()

  useEffect(() => {
    ensureDefaultExpenseCategories().catch((caught: unknown) => console.error('Không tạo được loại chi mặc định:', caught))
  }, [])

  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  )

  const filterName = categoryId === null ? null : categoryNames.get(categoryId)

  const categoryOf = (expense: Expense) =>
    expense.categoryId === null ? undefined : categoryNames.get(expense.categoryId)

  const titleOf = (expense: Expense) => expense.note.trim() || categoryOf(expense) || 'Khoản chi'

  // Ghi chú trống thì tên loại đã lên làm tiêu đề, nhắc lại ngay dòng dưới là thừa.
  const describe = (expense: Expense) => {
    const time = format(expense.spentAt, 'HH:mm')
    const category = categoryOf(expense)
    return expense.note.trim() && category ? `${time} · ${category}` : time
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Chi phí" />

      <div className="flex justify-center border-b border-line py-1">
        <MonthPicker
          label={month?.label ?? '…'}
          canNext={month?.canNext ?? false}
          onPrev={() => setMonthOffset((offset) => offset - 1)}
          onNext={() => setMonthOffset((offset) => offset + 1)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <TotalBox
          label={month ? `CHI THÁNG ${month.monthNumber}` : 'CHI THÁNG NÀY'}
          amount={month?.monthTotal}
        />
        <TotalBox label="CHI HÔM NAY" amount={month?.todayTotal} />
      </div>

      {filterName ? (
        <p className="px-4 pb-2 text-[13px] text-muted">Hai ô trên chỉ tính loại “{filterName}”.</p>
      ) : null}

      {categories && categories.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          <SelectChip selected={categoryId === null} onClick={() => setCategoryId(null)}>
            Tất cả
          </SelectChip>
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
      ) : null}

      <div className="flex-1">
        {month === undefined ? (
          <ListSkeleton />
        ) : month.groups.length === 0 ? (
          <EmptyState
            message={
              filterName
                ? `Tháng này chưa có khoản chi nào thuộc loại “${filterName}”.`
                : 'Chưa ghi khoản chi nào tháng này. Tiền nhập hàng đã điền ở giá nhập mặt hàng thì đừng ghi lại ở đây, kẻo tính hai lần.'
            }
          />
        ) : (
          month.groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-baseline justify-between bg-surface px-4 py-1.5">
                <span className="label-xs text-muted">{group.label}</span>
                <span className="money text-[13px] font-bold text-danger">{minus(group.total)} đ</span>
              </div>
              <ul>
                {group.items.map((expense) => (
                  <li key={expense.id}>
                    <ListRow
                      onClick={() => setEditing(expense)}
                      title={titleOf(expense)}
                      subtitle={describe(expense)}
                      right={<span className="money font-bold text-danger">{minus(expense.amount)}</span>}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="sticky bottom-0 border-t border-line bg-white px-4 py-3">
        <Button size="cta" disabled={month === undefined} onClick={() => setEditing(null)}>
          ＋ Ghi chi phí
        </Button>
      </div>

      {editing !== undefined && month ? (
        <ExpenseSheet
          expense={editing}
          categories={categories ?? []}
          now={month.now}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  )
}
