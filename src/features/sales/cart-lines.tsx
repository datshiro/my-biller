import { useRef, useState } from 'react'
import { calcLineAmount, calcUnitPriceWithToppings } from '@/domain/order-total'
import { toppingLabel } from '@/domain/line-extras'
import { formatAmount, formatQty, parseQtyInput } from '@/domain/money'
import type { CartLine } from '@/domain/cart'

/** Tuỳ chọn, topping rồi ghi chú — cùng thứ tự với tem và phiếu. */
const extrasOf = (line: CartLine): string[] =>
  [...line.options, ...line.toppings.map((topping) => `+ ${toppingLabel(topping)}`), line.note].filter(Boolean)

/**
 * Cùng một món giờ tách được thành hai dòng theo tuỳ chọn, topping và ghi chú, nên tên món một mình KHÔNG
 * còn phân biệt được hai dòng: người dùng trình đọc màn hình gặp hai nút y hệt, và `sales.resource` bốc
 * theo `Số lượng %s` sẽ vi phạm strict mode. Dòng không có gì thêm giữ nguyên nhãn cũ nên ca cũ không đỏ.
 */
const nhãnDòng = (line: CartLine) => {
  const extras = extrasOf(line)
  return `${line.name}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`
}

/** Tên, đơn giá và phần thêm của một dòng — dùng chung cho giỏ sửa được và bản tóm tắt chỉ đọc lúc thu tiền. */
function LineInfo({ line }: { line: CartLine }) {
  return (
    <>
      <span className="block text-[15px] font-semibold">{line.name}</span>
      <span className="block text-[13px] text-muted">
        {formatAmount(calcUnitPriceWithToppings(line))}
        {line.unit ? ` / ${line.unit}` : ''}
        {/* Dấu này ở mức TỪNG DÒNG chứ không phải mức đơn: bật SỈ mà khách chỉ có giá riêng cho
            vài món thì phần còn lại vẫn là giá lẻ, và người bán cần thấy dòng nào là dòng nào. */}
        {line.priceSource === 'catalog' && line.unitPrice !== line.retailPrice ? (
          <span className="ml-1 rounded-full bg-brand px-1.5 text-[11px] font-bold uppercase text-white">
            sỉ
          </span>
        ) : null}
        {extrasOf(line).map((extra) => ` · ${extra}`)}
      </span>
    </>
  )
}

function StepperButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label === '−' ? 'Bớt một' : 'Thêm một'}
      onClick={onClick}
      className="h-11 w-11 shrink-0 rounded-btn border border-line bg-white text-[20px] font-bold leading-none active:bg-surface"
    >
      {label}
    </button>
  )
}

function QtyInput({
  line,
  onSetQty,
  onUnreadable,
}: {
  line: CartLine
  onSetQty: (key: string, qty: number) => void
  onUnreadable: (name: string, restored: number) => void
}) {
  const [text, setText] = useState(() => formatQty(line.qty))
  const qtyAtFocus = useRef(line.qty)

  // Cùng bẫy với `MoneyInput` (src/ui/money-input.tsx:64-71): ô giữ chuỗi đang gõ riêng, nên khi
  // `qty` bị đổi từ BÊN NGOÀI (nút ±, sheet sửa dòng) phải vẽ lại chuỗi đó. Chỉ so với giá trị
  // CHÍNH ô này vừa phát ra — so thẳng với `line.qty` thì gõ dở "0," bị vẽ đè giữa chừng.
  const [lastEmitted, setLastEmitted] = useState(line.qty)
  if (line.qty !== lastEmitted) {
    setLastEmitted(line.qty)
    setText(formatQty(line.qty))
  }

  const emit = (qty: number) => {
    setLastEmitted(qty)
    onSetQty(line.key, qty)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      aria-label={`Số lượng ${nhãnDòng(line)}`}
      value={text}
      onFocus={() => {
        qtyAtFocus.current = line.qty
      }}
      onChange={(event) => {
        const raw = event.currentTarget.value
        setText(raw)
        const qty = parseQtyInput(raw)
        // Số dương vào sổ ngay từng phím: gõ "50" rồi chạm thẳng THU TIỀN thì giỏ đã là 50 trước mọi
        // thứ tự blur/click của trình duyệt. `0` KHÔNG đi đường này — nó là tiền tố của "0,5", và xoá
        // dòng ở đây là tháo chính ô đang focus ra khỏi cây.
        if (qty !== null && qty > 0) emit(qty)
      }}
      onBlur={() => {
        const qty = parseQtyInput(text)
        // Dispatch THẲNG trong blur, không hoãn qua setTimeout/rAF: hoãn là mở lại đúng cửa sổ
        // "gõ 0 → chạm THU TIỀN → sheet hiện tổng còn kèm dòng đã bỏ".
        if (qty === 0) {
          onSetQty(line.key, 0)
          return
        }
        if (qty === null && text.trim() !== '') {
          // "1.000" đi qua "1.0" rồi "1.00" — cả hai ĐỌC ĐƯỢC là 1 — nên tới lúc blur giỏ đã mang số
          // sai rồi. Vẽ lại từ `line.qty` chỉ đóng dấu cái sai đó; phải trả về số lúc vào ô, và phải
          // nói ra, vì người bán đang tin là mình vừa đặt một nghìn ly.
          const restored = qtyAtFocus.current
          emit(restored)
          setText(formatQty(restored))
          onUnreadable(line.name, restored)
          return
        }
        setText(formatQty(line.qty))
      }}
      // Bàn phím `decimal` trên iOS không có phím Enter, nên `blur` mới là đường commit chính;
      // Enter chỉ là lối tắt cho bàn phím đầy đủ.
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="h-11 w-16 shrink-0 rounded-btn border border-line bg-surface text-center text-[17px] font-bold tabular-nums outline-none focus:border-brand"
    />
  )
}

export function CartLines({
  lines,
  onBump,
  onEdit,
  onSetQty,
  onUnreadableQty,
}: {
  lines: readonly CartLine[]
  onBump: (key: string, delta: number) => void
  onEdit: (line: CartLine) => void
  onSetQty: (key: string, qty: number) => void
  onUnreadableQty: (name: string, restored: number) => void
}) {
  return (
    <ul className="border-t border-line">
      {/* Tên đứng riêng một dòng: xếp cùng hàng với hai nút ±, ô số lượng và ô thành tiền thì trên
          máy 320px tên chỉ còn ~56px, "Phở bò tái nạm" và "Phở bò tái gầu" đều hiện thành "Phở b…". */}
      {lines.map((line) => (
        <li key={line.key} className="flex flex-col gap-1 border-b border-line px-4 py-2">
          <button
            type="button"
            onClick={() => onEdit(line)}
            className="w-full min-w-0 text-left"
            aria-label={`Sửa ${nhãnDòng(line)}`}
          >
            <LineInfo line={line} />
          </button>

          <div className="flex items-center gap-2">
            <StepperButton label="−" onClick={() => onBump(line.key, -1)} />
            <QtyInput line={line} onSetQty={onSetQty} onUnreadable={onUnreadableQty} />
            <StepperButton label="+" onClick={() => onBump(line.key, 1)} />

            <span className="money flex-1 text-right text-[15px] font-bold">
              {formatAmount(calcLineAmount(line))}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Các dòng đơn ở dạng chỉ đọc: người bán soát lại trước khi tạo đơn, muốn sửa thì quay về giỏ. */
export function CartLinesSummary({ lines }: { lines: readonly CartLine[] }) {
  return (
    <ul aria-label="Các món trong đơn" className="border-t border-line">
      {lines.map((line) => (
        <li key={line.key} aria-label={nhãnDòng(line)} className="flex items-start gap-3 border-b border-line py-2">
          <div className="min-w-0 flex-1">
            <LineInfo line={line} />
          </div>
          <div className="shrink-0 text-right">
            <span className="block text-[13px] text-muted">× {formatQty(line.qty)}</span>
            <span className="money block text-[15px] font-bold">{formatAmount(calcLineAmount(line))}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
