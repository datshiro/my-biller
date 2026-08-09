import { memo, useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useCustomer } from './use-customers'
import { useCustomerPriceSheet, type PriceSheet, type PricedItem } from './use-customer-prices'
import { savePriceBook, type PriceEntry } from '@/db/repositories/customer-prices'
import { formatAmount } from '@/domain/money'
import { normalizeName } from '@/domain/order-draft/parse-order-text'
import { Button } from '@/ui/button'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { FormScreen } from '@/ui/form-screen'
import { MoneyInput } from '@/ui/money-input'
import { SearchInput } from '@/ui/search-input'
import { useSubmitOnce } from '@/ui/use-submit-once'

/**
 * `memo` ở đây là **yêu cầu**, không phải tối ưu sớm. Quán 200 mặt hàng là 200 `MoneyInput`, mỗi cái mang
 * một `useLayoutEffect` không có mảng phụ thuộc (`money-input.tsx:55-59`) nên chạy sau **mọi** render.
 * Không chặn ở đây thì gõ một chữ số ở ô thứ 80 kéo theo 200 lượt render + 200 lượt layout effect.
 *
 * Chặn được là nhờ `onChange` ổn định (page dùng `useCallback` + setState dạng hàm) và `value` chỉ đổi ở
 * đúng dòng đang gõ.
 */
const PriceRow = memo(function PriceRow({
  item,
  value,
  onChange,
}: {
  item: PricedItem
  value: number | null
  onChange: (itemId: number, value: number | null) => void
}) {
  return (
    <MoneyInput
      label={item.name}
      hint={`Giá lẻ ${formatAmount(item.unitPrice)} / ${item.unit}`}
      value={value}
      onChange={(next) => onChange(item.id, next)}
      placeholder="Bán giá lẻ"
      enterKeyHint="next"
    />
  )
})

function PriceSheetForm({ customerId, name, sheet }: { customerId: number; name: string; sheet: PriceSheet }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [edited, setEdited] = useState<Map<number, number | null>>(
    () => new Map(sheet.items.map((item) => [item.id, sheet.prices.get(item.id) ?? null])),
  )
  const { submitting: saving, error: saveError, run } = useSubmitOnce('Không lưu được bảng giá. Thử lại.')

  const change = useCallback((itemId: number, value: number | null) => {
    setEdited((prev) => new Map(prev).set(itemId, value))
  }, [])

  const changed = sheet.items.filter((item) => (edited.get(item.id) ?? null) !== (sheet.prices.get(item.id) ?? null))

  const visible = useMemo(() => {
    const keyword = normalizeName(query)
    return keyword ? sheet.items.filter((item) => normalizeName(item.name).includes(keyword)) : sheet.items
  }, [sheet.items, query])

  const save = () =>
    void run(async () => {
      const entries: PriceEntry[] = changed.map((item) => ({
        itemId: item.id,
        unitPrice: edited.get(item.id) ?? null,
      }))
      await savePriceBook(customerId, entries)
      void navigate(`/them/khach-hang/${customerId}`, { replace: true })
    })

  return (
    <FormScreen
      title={`Bảng giá · ${name}`}
      error={saveError}
      dirty={changed.length > 0 && !saving}
      cta={
        <Button size="cta" disabled={saving} onClick={save}>
          {saving ? 'Đang lưu…' : 'LƯU BẢNG GIÁ'}
        </Button>
      }
    >
      {/* Câu này đóng vai trò tính năng: không có nó, người bán tưởng phải điền hết mọi món. */}
      <p className="text-[15px] text-muted">
        Để trống là bán giá lẻ. Chỉ nhập những món khách này có giá riêng.
      </p>

      {sheet.items.length === 0 ? (
        <EmptyState
          message="Chưa có mặt hàng nào để đặt giá. Thêm vài món trước đã."
          actionLabel="＋ Thêm mặt hàng"
          onAction={() => void navigate('/them/mat-hang/moi')}
        />
      ) : (
        <>
          {/* `-mx-4` khử phần đệm riêng của SearchInput để ô tìm thẳng hàng với các ô giá bên dưới. */}
          <div className="-mx-4">
            <SearchInput value={query} onChange={setQuery} placeholder="Tìm món…" />
          </div>

          {visible.length === 0 ? (
            <p className="py-4 text-center text-muted">Không có món nào khớp.</p>
          ) : (
            visible.map((item) => (
              <PriceRow key={item.id} item={item} value={edited.get(item.id) ?? null} onChange={change} />
            ))
          )}
        </>
      )}
    </FormScreen>
  )
}

export function CustomerPricePage() {
  const { id } = useParams()
  const customerId = id ? Number(id) : null

  const customer = useCustomer(customerId)
  const sheet = useCustomerPriceSheet(customerId)

  if (customer === undefined || sheet === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={4} />
      </div>
    )
  }

  if (customer === null || customer.id === undefined) {
    return <p className="p-6 text-muted">Không tìm thấy khách hàng này.</p>
  }

  return <PriceSheetForm customerId={customer.id} name={customer.name} sheet={sheet} />
}
