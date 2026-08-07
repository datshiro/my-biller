import type { ReactNode } from 'react'
import { ScreenHeader } from './screen-header'

/**
 * Màn dạng form: chiếm trọn màn hình, KHÔNG có bottom nav — đang nhập dở thì không nên nhảy tab.
 * Nút Lưu neo ở thanh dưới cố định để bàn phím Android không che mất.
 */
export function FormScreen({
  title,
  cta,
  error,
  children,
}: {
  title: string
  cta: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col bg-white">
      <ScreenHeader title={title} back="close" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-5">{children}</div>
      </div>

      <div className="safe-bottom shrink-0 border-t border-line px-4 pt-3">
        {error ? (
          <p role="alert" className="mb-2 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
            {error}
          </p>
        ) : null}
        {cta}
      </div>
    </div>
  )
}
