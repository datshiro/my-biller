import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from './confirm-dialog'
import { ScreenHeader } from './screen-header'
import { useUnsavedGuard } from './use-unsaved-guard'

/**
 * Màn dạng form: chiếm trọn màn hình, KHÔNG có bottom nav — đang nhập dở thì không nên nhảy tab.
 * Nút Lưu neo ở thanh dưới cố định để bàn phím Android không che mất.
 */
export function FormScreen({
  title,
  cta,
  error,
  dirty = false,
  children,
}: {
  title: string
  cta: ReactNode
  error?: string | null
  /** Có chữ chưa lưu — bấm ✕ hay tải lại trang thì hỏi lại thay vì im lặng bỏ hết. */
  dirty?: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  useUnsavedGuard(dirty)

  return (
    <div className="flex h-dvh flex-col bg-white">
      <ScreenHeader
        title={title}
        back="close"
        onBack={dirty ? () => setLeaving(true) : undefined}
      />

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

      {leaving ? (
        <ConfirmDialog
          title="Bỏ những gì đang nhập?"
          message="Chữ vừa gõ chưa được lưu, thoát ra là mất."
          confirmLabel="Bỏ"
          onConfirm={() => void navigate(-1)}
          onCancel={() => setLeaving(false)}
        />
      ) : null}
    </div>
  )
}
