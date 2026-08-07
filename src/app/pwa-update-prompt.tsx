import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Service worker dùng registerType 'prompt' — không bao giờ tự reload.
 * Reload giữa lúc đang lên đơn là mất đơn, nên phải để người bán tự bấm.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="flex items-center gap-3 border-t border-line bg-brand-tint px-4 py-3">
      <p className="flex-1 text-[13px] text-ink">Có bản mới. Tải lại khi bạn đang rảnh tay.</p>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="min-h-12 px-3 text-[14px] font-semibold text-muted"
      >
        Để sau
      </button>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="min-h-12 rounded-btn bg-brand px-4 text-[14px] font-bold text-white"
      >
        Tải lại
      </button>
    </div>
  )
}
