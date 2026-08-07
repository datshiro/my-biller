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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Đóng"
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
