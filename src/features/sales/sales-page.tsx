import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CartLines } from './cart-lines'
import { CustomerPickerSheet } from './customer-picker-sheet'
import { ItemGrid } from './item-grid'
import { LineEditSheet } from './line-edit-sheet'
import { PaymentSheet, type PaymentChoice, type PayMethod } from './payment-sheet'
import { useCart } from './use-cart'
import { useToday } from './use-today'
import { buildPriceBook, listPriceBook } from '@/db/repositories/customer-prices'
import { getCustomer } from '@/db/repositories/customers'
import { createOrder } from '@/db/repositories/orders'
import { useItemGroups, useItems } from '@/features/items/use-items'
import { BackupBanner } from '@/features/settings/backup-banner'
import { useDeviceIdentity } from '@/features/settings/use-settings'
import { cartCount, cartTotals, KHACH_LE, type CartLine } from '@/domain/cart'
import { formatAmount, formatQty, formatVnd } from '@/domain/money'
import { normalizeName, parseOrderText } from '@/domain/order-draft/parse-order-text'
import { resolveUnitPrice, type PriceBook, type PriceMode } from '@/domain/wholesale-price'
import type { Item } from '@/domain/schema'
import { Button } from '@/ui/button'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { SearchInput } from '@/ui/search-input'
import { SelectChip } from '@/ui/chip'
import { useSubmitOnce } from '@/ui/use-submit-once'
import { AdjustSheet } from './adjust-sheet'

/** `customer-for-debt` là màn chọn khách mở TỪ sheet thu tiền — chọn xong phải quay lại đúng chỗ cũ. */
type OpenSheet = 'none' | 'payment' | 'customer' | 'customer-for-debt' | 'adjust'

const KHONG_CO_GIA_RIENG: PriceBook = new Map()

export function SalesPage() {
  const navigate = useNavigate()
  const items = useItems()
  const groups = useItemGroups()
  const today = useToday()
  const deviceIdentity = useDeviceIdentity()
  const { cart, dispatch, reset, restored } = useCart()

  const [query, setQuery] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [sheet, setSheet] = useState<OpenSheet>('none')
  const [payMethod, setPayMethod] = useState<PayMethod>('cash')
  const [editing, setEditing] = useState<CartLine | null>(null)
  const { submitting, error: saveError, setError: setSaveError, run } = useSubmitOnce('Không lưu được đơn. Thử lại.')

  /** Bảng giá của khách đang chọn. Nạp một lần mỗi lần đổi khách hoặc đổi chế độ, **không** `useLiveQuery`. */
  const [book, setBook] = useState<PriceBook>(KHONG_CO_GIA_RIENG)
  /**
   * Chế độ người bán **vừa chọn**, đổi ngay lúc chạm. `cart.priceMode` chỉ đổi sau khi bảng giá về, nên
   * đọc nó để quyết định là sai hai lần: công tắc đứng yên cả lúc chờ, và khách đổi trong cửa sổ đó bị
   * tính là "đang Lẻ" nên rơi hẳn về giá lẻ thay vì nạp bảng giá của khách mới.
   */
  const [shownMode, setShownMode] = useState<PriceMode>(cart.priceMode)
  const [repricing, setRepricing] = useState(false)
  const [notice, setNotice] = useState<{ text: string; undo?: CartLine } | null>(null)
  /** Chạm SỈ khi chưa có khách: nhớ ý định, bật lên sau khi người bán chọn xong khách. */
  const [wantWholesale, setWantWholesale] = useState(false)
  /**
   * Chống lệch khi đổi khách hai nhịp nhanh. `await` một mình không đủ: hai lượt đọc IndexedDB không
   * bảo đảm về theo thứ tự gọi, nên lượt về sau có thể là bảng giá của khách **trước**.
   */
  const requestId = useRef(0)

  /**
   * `null` = người bán **chưa** gõ tay, ô "Khách đưa" bám theo tổng hiện tại. Giữ dạng này thay vì
   * `setGiven` mỗi lần tổng đổi vì hai lẽ: không có khoảnh khắc nào `given` là số của tổng cũ, và số
   * người bán **đã** gõ thì không ai đụng vào — `robot/tests/ban-hang.robot:91` khoá đúng chỗ đó.
   * `atTotal` là tổng lúc gõ, để biết tổng có đổi sau lưng người bán hay không.
   */
  const [given, setGiven] = useState<{ value: number | null; atTotal: number } | null>(null)

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
  const wholesale = shownMode === 'wholesale'
  /** Đếm ngay trong render từ giỏ hiện tại, nên không bao giờ lệch với những gì đang hiện trên màn. */
  const priced = cart.lines.filter(
    (line) => line.priceSource === 'catalog' && line.unitPrice !== line.retailPrice,
  ).length

  const qtyOf = (itemId: number) =>
    cart.lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0)

  const priceOf = (item: Item) =>
    resolveUnitPrice({ itemId: item.id ?? null, retailPrice: item.unitPrice }, cart.priceMode, book)

  /**
   * Một đường duy nhất cho mọi thứ làm giá đổi: công tắc, đổi khách, khôi phục nháp. Bảng giá đọc xong
   * mới dispatch, và chỉ dispatch nếu trong lúc chờ chưa có yêu cầu mới hơn.
   */
  const applyMode = async (mode: PriceMode, customerId: number | null) => {
    const req = (requestId.current += 1)
    // Nút Hoàn lại giữ ảnh chụp của dòng lúc bị gỡ, kèm giá theo bảng giá của khách CŨ. Đổi khách
    // hay bật/tắt SỈ xong mới bấm Hoàn lại là chèn giá cũ vào giỏ của khách mới, và không gì tính
    // lại nó cho tới lần toggle sau. Bỏ đường hoàn tác đi khi nền giá đã đổi.
    setNotice(null)
    setShownMode(mode)
    setRepricing(true)
    try {
      const rows = mode === 'wholesale' && customerId !== null ? await listPriceBook(customerId) : []
      if (req !== requestId.current) return

      const next = mode === 'wholesale' ? buildPriceBook(rows) : KHONG_CO_GIA_RIENG
      setBook(next)
      dispatch({ type: 'applyPriceMode', mode, book: next })
      setRepricing(false)
    } catch (caught) {
      console.error('Không đọc được bảng giá của khách:', caught)
      if (req !== requestId.current) return
      // `cart.priceMode` của closure này chính là chế độ đã chốt: lượt đọc vừa hỏng chưa dispatch gì, và
      // không action nào khác đụng tới `priceMode`. Không trả công tắc về đây là để nó nói dối.
      setShownMode(cart.priceMode)
      setRepricing(false)
      setNotice({
        text: 'Không đọc được bảng giá của khách. Giá trong giỏ giữ nguyên — chọn lại khách để thử lại.',
      })
    }
  }

  /**
   * Nháp có thể sống lâu hơn bảng giá và lâu hơn cả khách. Mở màn mà không tính lại thì công tắc hiện
   * SỈ trong khi bảng giá rỗng: món thêm mới vào giỏ ở giá lẻ, nằm cạnh những dòng giá sỉ cũ.
   *
   * Chốt ở chế độ giá của giỏ chứ không ở `restored`: `book` là state của màn nên **mọi** lần dựng lại
   * màn đều bắt đầu với bảng giá rỗng, kể cả khi người bán chỉ bấm sang màn khác rồi quay lại chứ không
   * hề đóng app — mà đúng những lần đó thì `restored` là false.
   */
  const repricedOnMount = useRef(false)
  useEffect(() => {
    if (repricedOnMount.current) return
    repricedOnMount.current = true
    if (cart.priceMode !== 'wholesale') return

    const customerId = cart.customerId
    void (async () => {
      if (customerId !== null && (await getCustomer(customerId))) {
        await applyMode('wholesale', customerId)
        return
      }
      dispatch({ type: 'setCustomer', customerId: null, customerName: '' })
      await applyMode('retail', null)
      setNotice({
        text: 'Khách của đơn đang lên dở không còn nữa. Đã chuyển về giá lẻ — xem lại giá trước khi thu tiền.',
      })
    })()
    // Chỉ chạy đúng một lần lúc mở màn; `repricedOnMount` là chốt, không phải mảng phụ thuộc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickMode = (mode: PriceMode) => {
    if (mode === 'wholesale' && cart.customerId === null) {
      // Giá sỉ là giá **của một khách cụ thể**; chưa có khách thì chưa có gì để tra.
      setWantWholesale(true)
      setSheet('customer')
      return
    }
    setWantWholesale(false)
    void applyMode(mode, cart.customerId)
  }

  const pickCustomer = ({ customerId, customerName }: { customerId: number | null; customerName: string }) => {
    dispatch({ type: 'setCustomer', customerId, customerName })
    // Khách lẻ không có bảng giá riêng nào để tra, nên chọn "Khách lẻ" khi đang SỈ là tự hạ về Lẻ.
    const mode: PriceMode = (wantWholesale || wholesale) && customerId !== null ? 'wholesale' : 'retail'
    setWantWholesale(false)
    void applyMode(mode, customerId)
  }

  const addItem = (item: Item) => {
    dispatch({ type: 'addItem', item, book })
    setQuery('')
  }

  /** Mở thu tiền cho một lượt mới — chỉ ở đây mới được đặt lại hình thức và số tiền khách đưa. */
  const openPayment = () => {
    setPayMethod('cash')
    setGiven(null)
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

    for (const line of parsed) dispatch({ type: 'addLine', line, book })
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

  if (deviceIdentity === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={5} />
      </div>
    )
  }

  if (deviceIdentity === null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          message="Đặt tên máy trước khi bán. Máy cần một chữ cái riêng để mã phiếu không trùng với điểm bán khác."
          actionLabel="ĐẶT TÊN MÁY"
          onAction={() => void navigate('/cai-dat-may', { state: { returnTo: '/' } })}
        />
      </div>
    )
  }

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

      {/* Hàng riêng chứ không nhét vào header: header ở 320px đã kín, và công tắc này cần chạm to. */}
      <div role="group" aria-label="Giá bán" className="flex gap-2 border-b border-line px-4 py-2">
        <SelectChip selected={!wholesale} onClick={() => pickMode('retail')}>
          Lẻ
        </SelectChip>
        <SelectChip selected={wholesale} onClick={() => pickMode('wholesale')}>
          SỈ
        </SelectChip>
        {wholesale ? (
          <p className="min-w-0 flex-1 self-center text-[13px] text-muted">
            Giá của <span className="font-semibold text-ink">{cart.customerName || KHACH_LE}</span>
            {priced > 0 ? ` · ${priced} món lấy giá riêng` : ' · chưa món nào có giá riêng'}
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="flex items-start gap-2 bg-warn-tint px-4 py-2 text-[13px] font-semibold text-warn">
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.undo ? (
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'restoreLine', line: notice.undo! })
                setNotice(null)
              }}
              className="shrink-0 underline"
            >
              Hoàn lại
            </button>
          ) : (
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
              Đã hiểu
            </button>
          )}
        </p>
      ) : null}

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
          // Gõ tên một món chưa có là lúc muốn tạo nó nhất, mà đây lại đúng nhánh lưới biến mất —
          // ô thêm món nằm trong lưới nên cũng đi theo. Mang tên vừa gõ sang form luôn.
          <EmptyState
            message="Không có món nào khớp."
            actionLabel="＋ Thêm mặt hàng"
            onAction={() => void navigate('/them/mat-hang/moi', { state: { itemName: query.trim() } })}
          />
        ) : (
          <ItemGrid
            items={visible}
            qtyOf={qtyOf}
            priceOf={priceOf}
            onPick={addItem}
            onAdd={() => void navigate('/them/mat-hang/moi')}
          />
        )}

        {count > 0 ? (
          <>
            <h2 className="label-xs px-4 pb-2 pt-4 text-muted">TRONG ĐƠN</h2>
            <CartLines
              lines={cart.lines}
              onBump={(key, delta) => dispatch({ type: 'bumpQty', key, delta })}
              onEdit={setEditing}
              onSetQty={(key, qty) => {
                // Gõ `0` là bỏ món (chốt của chủ quán), nhưng `0` cũng là phím ĐẦU của "0,5" — nên
                // phải luôn có đường về. Giữ nguyên dòng vừa gỡ để nút Hoàn lại đặt lại y hệt.
                if (qty === 0) {
                  const removed = cart.lines.find((line) => line.key === key)
                  if (removed) setNotice({ text: `Đã bỏ ${removed.name} khỏi đơn.`, undo: removed })
                }
                dispatch({ type: 'setQty', key, qty })
              }}
              onUnreadableQty={(name, restored) =>
                setNotice({
                  text: `Số lượng của ${name} không đọc được — đã giữ nguyên ${formatQty(restored)}.`,
                })
              }
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
          {/* Giảm giá và giá sỉ cộng dồn được, nhưng chồng nhau thì tiền hàng tụt sát giảm giá và
              `calcOrderTotals` kẹp giảm giá lại **trong im lặng** — đủ để ra một đơn 0đ ghi là trả đủ.
              Cảnh báo đặt ở thanh tổng vì đây là chỗ duy nhất thấy được ở CẢ HAI thứ tự thao tác. */}
          {wholesale && cart.discount > 0 ? (
            <p className="mb-2 text-[13px] font-semibold text-warn">
              Đang bán giá sỉ mà vẫn còn giảm giá {formatAmount(cart.discount)} — kiểm lại tổng trước khi thu.
            </p>
          ) : null}
          {repricing ? (
            <p className="mb-2 text-[13px] text-muted">Đang tính lại giá theo bảng giá của khách…</p>
          ) : null}
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
          <Button size="cta" disabled={repricing} onClick={openPayment}>
            THU TIỀN · {count} món
          </Button>
        </div>
      ) : null}

      {sheet === 'payment' ? (
        <PaymentSheet
          total={totals.total}
          hasCustomer={cart.customerId !== null}
          method={payMethod}
          given={given ? given.value : totals.total}
          givenWarning={
            given && given.atTotal !== totals.total
              ? `Tổng đơn đã đổi thành ${formatAmount(totals.total)} sau khi bạn gõ số này.`
              : undefined
          }
          onMethodChange={setPayMethod}
          onGivenChange={(value) => setGiven({ value, atTotal: totals.total })}
          // Đang tính lại giá thì khoá luôn nút chốt: bấm lọt trong cửa sổ đó là ghi đơn ở giá cũ,
          // rồi `reset()` xoá sạch giỏ nên không còn gì để đối chiếu.
          submitting={submitting || repricing}
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
          onPick={(picked) => {
            pickCustomer(picked)
            // Chọn khách từ header chỉ là gán tên, không phải ý định thu tiền: tự bật sheet thu tiền
            // là đặt nút XONG cao 56px ngay dưới ngón tay vừa chạm.
            setSheet(sheet === 'customer-for-debt' ? 'payment' : 'none')
          }}
          onClose={() => {
            setWantWholesale(false)
            setSheet(sheet === 'customer-for-debt' ? 'payment' : 'none')
          }}
        />
      ) : null}

      {sheet === 'adjust' ? (
        <AdjustSheet
          subtotal={totals.subtotal}
          discount={cart.discount}
          surcharge={cart.surcharge}
          wholesale={wholesale}
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
