import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Tấm trượt từ đáy. Dùng `dvh` chứ không `vh`: bàn phím số Android đẩy viewport, `vh` sẽ để nút
 * xác nhận nằm dưới bàn phím. Nội dung cuộn trong sheet, phần chân luôn thấy.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  // Chỉ lấy focus đúng lúc mở. Gộp chung với listener Escape thì mỗi lần màn ngoài vẽ lại,
  // `onClose` là hàm mới nên effect chạy lại và giật focus ra khỏi ô người dùng đang gõ dở.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  // Khai `aria-modal` thì Tab cũng phải ở lại trong sheet, nếu không thì control cuối cùng đưa người
  // dùng ra thẳng lưới mặt hàng phía sau mà không có dấu hiệu gì.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const stops = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return

      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panel.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Lớp phủ nằm trước panel trong DOM nên nếu nhận được focus thì Shift+Tab từ đầu sheet sẽ rơi
          vào một nút đóng. Nút ✕ trong panel đã là đường đóng cho bàn phím; lớp này chỉ để chạm. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[90dvh] flex-col rounded-t-2xl bg-white outline-none"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="h-10 px-2 text-muted" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  )
}
