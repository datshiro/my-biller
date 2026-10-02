import { useId, useLayoutEffect, useRef, useState } from 'react'
import { formatAmount, MAX_MONEY_INPUT, parseMoneyInput } from '@/domain/money'
import { Field } from './text-field'

const QUICK_ADD = [1_000, 5_000, 10_000]
const OVER_LIMIT = `Tối đa ${formatAmount(MAX_MONEY_INPUT)} đ.`

/** Chỗ đứng trong `text` ngay sau chữ số thứ `count`; dấu phân nhóm không được tính. */
function afterDigits(text: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i += 1) {
    if (!/\d/.test(text.charAt(i))) continue
    seen += 1
    if (seen === count) return i + 1
  }
  return text.length
}

/**
 * Ô nhập tiền. Component tự chèn dấu phân nhóm nên khi đọc lại nó bỏ đúng những dấu đó ra —
 * `parseMoneyInput` nghiêm ngặt vẫn là bộ đọc duy nhất.
 *
 * Bàn phím số trên Android không có phím `k`, nên hàng nút +1k/+5k/+10k mới là lối tắt thật trên điện thoại;
 * gõ "50k" chỉ dùng được ở nơi có bàn phím đầy đủ.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  warning,
  error,
  large = false,
  quickAdd = false,
  placeholder,
  enterKeyHint,
  inputRef,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  warning?: string
  error?: string
  large?: boolean
  quickAdd?: boolean
  placeholder?: string
  /** Danh sách nhiều ô liền nhau đặt `"next"` để bàn phím Android có phím sang ô kế thay vì phím xuống dòng. */
  enterKeyHint?: 'next' | 'done'
  /** Để màn ngoài đặt con trỏ vào đây khi mở — `autoFocus` thua hiệu ứng focus của `Sheet`. */
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const id = useId()
  const [text, setText] = useState(() => (value === null ? '' : formatAmount(value)))
  const [overLimit, setOverLimit] = useState(false)

  // Đặt lại con trỏ **trước khi màn hình vẽ** nên mắt không kịp thấy nó nhảy.
  const pendingCaret = useRef<{ node: HTMLInputElement; at: number } | null>(null)
  useLayoutEffect(() => {
    const pending = pendingCaret.current
    pendingCaret.current = null
    pending?.node.setSelectionRange(pending.at, pending.at)
  })

  // Ô giữ chuỗi đang gõ riêng, nên khi cha đổi `value` (nút gợi ý tiền khách đưa chẳng hạn) phải
  // vẽ lại chuỗi đó. Chỉ so với giá trị CHÍNH ô này vừa phát ra — nếu so thẳng với `value`,
  // lúc gõ dở một chuỗi chưa hợp lệ (`onChange(null)`) ô sẽ tự xoá chữ người dùng đang gõ.
  const [lastEmitted, setLastEmitted] = useState(value)
  if (value !== lastEmitted) {
    setLastEmitted(value)
    setText(value === null ? '' : formatAmount(value))
    setOverLimit(false)
  }

  const emit = (next: number | null) => {
    setLastEmitted(next)
    onChange(next)
  }

  // Phím làm vượt trần bị bỏ chứ không đẩy `null` lên cha: `null` ở ô "Khách đưa" nghĩa là chưa
  // đưa đồng nào, nên một phím thừa không được âm thầm biến đơn trả đủ thành đơn nợ.
  const rejectOverLimit = (next: number | null) => {
    const over = next !== null && next > MAX_MONEY_INPUT
    setOverLimit(over)
    return over
  }

  const apply = (next: number | null) => {
    if (rejectOverLimit(next)) return
    setText(next === null ? '' : formatAmount(next))
    emit(next)
  }

  const handleType = (node: HTMLInputElement) => {
    const raw = node.value
    const digits = raw.replace(/[^\dk]/gi, '')
    const parsed = digits === '' ? null : parseMoneyInput(digits)
    if (rejectOverLimit(parsed)) return
    const next = parsed === null ? digits : formatAmount(parsed)

    // Chuỗi vẽ lại có dấu chấm ở chỗ khác chuỗi vừa gõ, mà React dựng lại `value` thì trình duyệt ném
    // con trỏ về cuối — sửa một chữ số giữa "1.500.000" là mỗi phím lại phải rê tay về chỗ cũ. Nhớ
    // chỗ đứng theo **số chữ số** đứng trước con trỏ, dấu chấm nằm đâu không đổi.
    if (next !== text) {
      const typed = raw.slice(0, node.selectionStart ?? raw.length).replace(/[^\dk]/gi, '')
      pendingCaret.current = { node, at: afterDigits(next, typed.length) }
    }

    setText(next)
    emit(parsed)
  }

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      warning={warning}
      error={error ?? (overLimit ? OVER_LIMIT : undefined)}
    >
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          inputMode="numeric"
          enterKeyHint={enterKeyHint}
          value={text}
          placeholder={placeholder}
          onChange={(event) => handleType(event.currentTarget)}
          aria-invalid={error || overLimit ? true : undefined}
          className={`w-full rounded-btn border bg-surface pr-9 text-right money outline-none focus:border-brand ${
            large ? 'h-14 pl-3 text-[24px] font-bold' : 'h-12 pl-3 text-[17px] font-semibold'
          } ${error || overLimit ? 'border-danger' : 'border-line'}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">đ</span>
      </div>

      {quickAdd ? (
        <div className="mt-2 flex gap-2">
          {QUICK_ADD.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => apply((value ?? 0) + step)}
              className="h-12 flex-1 rounded-btn border border-line bg-white font-semibold active:bg-surface"
            >
              +{step / 1000}k
            </button>
          ))}
          <button
            type="button"
            onClick={() => apply(null)}
            className="h-12 flex-1 rounded-btn border border-line bg-white font-semibold text-muted active:bg-surface"
          >
            Xoá
          </button>
        </div>
      ) : null}
    </Field>
  )
}
