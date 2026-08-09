import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CartLines } from './cart-lines'
import { CustomerPickerSheet } from './customer-picker-sheet'
import { ItemGrid } from './item-grid'
import { LineEditSheet } from './line-edit-sheet'
import { PaymentSheet, type PaymentChoice, type PayMethod } from './payment-sheet'
import { useCart } from './use-cart'
import { useToday } from './use-today'
import { createOrder } from '@/db/repositories/orders'
import { useItemGroups, useItems } from '@/features/items/use-items'
import { BackupBanner } from '@/features/settings/backup-banner'
import { cartCount, cartTotals, KHACH_LE, type CartLine } from '@/domain/cart'
import { formatAmount, formatVnd } from '@/domain/money'
import { normalizeName, parseOrderText } from '@/domain/order-draft/parse-order-text'
import type { PriceBook } from '@/domain/wholesale-price'
import type { Item } from '@/domain/schema'
import { Button } from '@/ui/button'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { SearchInput } from '@/ui/search-input'
import { SelectChip } from '@/ui/chip'
import { useSubmitOnce } from '@/ui/use-submit-once'
import { AdjustSheet } from './adjust-sheet'

/** `customer-for-debt` là màn chọn khách mở TỪ sheet thu tiền — chọn xong phải quay lại đúng chỗ cũ. */
type OpenSheet = 'none' | 'payment' | 'customer' | 'customer-for-debt' | 'adjust'

/**
 * Chưa có công tắc Lẻ/SỈ nên chưa khách nào có bảng giá được nạp: mọi dòng vào giỏ bằng giá lẻ, đúng như
 * hôm nay. Phase 4 thay hằng này bằng bảng giá thật của khách đang chọn.
 */
const CHUA_NAP_BANG_GIA: PriceBook = new Map()

export function SalesPage() {
  const navigate = useNavigate()
  const items = useItems()
  const groups = useItemGroups()
  const today = useToday()
  const { cart, dispatch, reset, restored } = useCart()

  const [query, setQuery] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<OpenSheet>('none')
  const [payMethod, setPayMethod] = useState<PayMethod>('cash')
  const [given, setGiven] = useState<number | null>(null)
  const [editing, setEditing] = useState<CartLine | null>(null)
  const { submitting, error: saveError, setError: setSaveError, run } = useSubmitOnce('Không lưu được đơn. Thử lại.')

  const active = useMemo(() => (items ?? []).filter((item) => item.isActive === 1), [items])

  const visible = useMemo(() => {
    const keyword = normalizeName(query)
    return active.filter(
      (item) =>
        (groupId === null || item.groupId === groupId) &&
        (!keyword || normalizeName(item.name).includes(keyword)),
    )
  }, [active, groupId, query])

  const totals = cartTotals(cart)
  const count = cartCount(cart)

  const qtyOf = (itemId: number) =>
    cart.lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0)

  const addItem = (item: Item) => {
    dispatch({ type: 'addItem', item, book: CHUA_NAP_BANG_GIA })
    setQuery('')
  }

  /** Mở thu tiền cho một lượt mới — chỉ ở đây mới được đặt lại hình thức và số tiền khách đưa. */
  const openPayment = () => {
    setPayMethod('cash')
    setGiven(totals.total)
    setSheet('payment')
  }

  /** Enter ở ô tìm: gõ "2 pho" thêm 2 Phở; gõ tên thường thì thêm kết quả đầu tiên. */
  const submitQuery = () => {
    const candidates = active.flatMap((item) =>
      item.id === undefined
        ? []
        : [{ id: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice, costPrice: item.costPrice }],
    )
    const parsed = parseOrderText(query, candidates)
    if (parsed.length === 0) return

    for (const line of parsed) dispatch({ type: 'addLine', line, book: CHUA_NAP_BANG_GIA })
    setQuery('')
  }

  // Nhánh lỗi của `run` không đụng tới giỏ: đơn chưa ghi được thì người bán phải còn nguyên hàng để thử lại.
  const finish = (payment: PaymentChoice) =>
    void run(async () => {
      const { id } = await createOrder({
        customerId: cart.customerId,
        customerName: cart.customerName || KHACH_LE,
        lines: cart.lines.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          unit: line.unit,
          unitPrice: line.unitPrice,
          costPrice: line.costPrice,
          qty: line.qty,
        })),
        discount: cart.discount,
        surcharge: cart.surcharge,
        soldAt: Date.now(),
        note: cart.note,
        payment,
      })

      reset()
      setSheet('none')
      // Chốt xong là đưa thẳng tới phiếu để gửi khách — đó là việc kế tiếp của người bán.
      // `replace` để nút back không quay lại giỏ đã chốt.
      void navigate(`/don/${id}/phieu`, { replace: true })
    })

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={() => setSheet('customer')} className="min-w-0 text-left">
          <span className="label-xs block text-muted">KHÁCH</span>
          <span className="block truncate text-[17px] font-bold">
            {cart.customerName || KHACH_LE} <span className="text-muted">▾</span>
          </span>
        </button>
        <div className="shrink-0 text-right">
          <span className="label-xs block text-muted">HÔM NAY</span>
          <span className="money block text-[17px] font-bold">
            {today ? formatAmount(today.revenue) : '…'}
          </span>
        </div>
      </header>

      <BackupBanner />

      {restored && count > 0 ? (
        <p className="bg-warn-tint px-4 py-2 text-[13px] font-semibold text-warn">
          Đã khôi phục đơn đang lên dở.{' '}
          <button type="button" onClick={reset} className="underline">
            Bỏ đi
          </button>
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SearchInput
          value={query}
          onChange={setQuery}
          onSubmit={submitQuery}
          placeholder="Tìm món, hoặc gõ “2 phở”…"
        />

        {groups && groups.length > 0 ? (
          <div role="group" aria-label="Nhóm" className="flex gap-2 overflow-x-auto px-4 pb-3">
            <SelectChip selected={groupId === null} onClick={() => setGroupId(null)}>
              Tất cả
            </SelectChip>
            {groups.map((group) => (
              <SelectChip
                key={group.id}
                selected={groupId === group.id}
                onClick={() => setGroupId(group.id ?? null)}
              >
                {group.name}
              </SelectChip>
            ))}
          </div>
        ) : null}

        {items === undefined ? (
          <ListSkeleton />
        ) : active.length === 0 ? (
          <EmptyState
            message="Chưa có mặt hàng nào để bán. Thêm vài món trước đã — chỉ cần tên và giá bán."
            actionLabel="＋ Thêm mặt hàng"
            onAction={() => void navigate('/them/mat-hang/moi')}
          />
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-muted">Không có món nào khớp.</p>
        ) : (
          <ItemGrid items={visible} qtyOf={qtyOf} onPick={addItem} />
        )}

        {count > 0 ? (
          <>
            <h2 className="label-xs px-4 pb-2 pt-4 text-muted">TRONG ĐƠN</h2>
            <CartLines
              lines={cart.lines}
              onBump={(key, delta) => dispatch({ type: 'bumpQty', key, delta })}
              onEdit={setEditing}
            />
            <div className="px-4 py-3">
              <Button variant="secondary" onClick={() => setSheet('adjust')}>
                Giảm giá / phụ thu
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {count > 0 ? (
        <div className="border-t border-line bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {totals.discount > 0 || totals.surcharge > 0 ? (
            <p className="mb-1 text-[13px] text-muted">
              Hàng {formatAmount(totals.subtotal)}
              {totals.discount > 0 ? ` · giảm ${formatAmount(totals.discount)}` : ''}
              {totals.surcharge > 0 ? ` · phụ thu ${formatAmount(totals.surcharge)}` : ''}
            </p>
          ) : null}
          <div className="mb-3 flex items-baseline justify-between">
            <span className="label-xs text-muted">TỔNG CỘNG</span>
            <span className="money money-xl">{formatVnd(totals.total)}</span>
          </div>
          <Button size="cta" onClick={openPayment}>
            THU TIỀN · {count} món
          </Button>
        </div>
      ) : null}

      {sheet === 'payment' ? (
        <PaymentSheet
          total={totals.total}
          hasCustomer={cart.customerId !== null}
          method={payMethod}
          given={given}
          onMethodChange={setPayMethod}
          onGivenChange={setGiven}
          submitting={submitting}
          error={saveError}
          onConfirm={finish}
          onPickCustomer={() => setSheet('customer-for-debt')}
          onClose={() => {
            setSheet('none')
            setSaveError(null)
          }}
        />
      ) : null}

      {sheet === 'customer' || sheet === 'customer-for-debt' ? (
        <CustomerPickerSheet
          reason={sheet === 'customer-for-debt' ? 'Nợ phải có chủ — chọn khách rồi mới ghi nợ được.' : undefined}
          onPick={({ customerId, customerName }) => {
            dispatch({ type: 'setCustomer', customerId, customerName })
            // Chọn khách từ header chỉ là gán tên, không phải ý định thu tiền: tự bật sheet thu tiền
            // là đặt nút XONG cao 56px ngay dưới ngón tay vừa chạm.
            setSheet(sheet === 'customer-for-debt' ? 'payment' : 'none')
          }}
          onClose={() => setSheet(sheet === 'customer-for-debt' ? 'payment' : 'none')}
        />
      ) : null}

      {sheet === 'adjust' ? (
        <AdjustSheet
          subtotal={totals.subtotal}
          discount={cart.discount}
          surcharge={cart.surcharge}
          onApply={({ discount, surcharge }) => {
            dispatch({ type: 'setDiscount', discount })
            dispatch({ type: 'setSurcharge', surcharge })
            setSheet('none')
          }}
          onClose={() => setSheet('none')}
        />
      ) : null}

      {editing ? (
        <LineEditSheet
          line={editing}
          onApply={({ qty, unitPrice, note }) => {
            dispatch({ type: 'updateLine', key: editing.key, qty, unitPrice, note })
            setEditing(null)
          }}
          onRemove={() => {
            dispatch({ type: 'removeLine', key: editing.key })
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}
