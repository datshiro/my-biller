import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

export function ScreenHeader({
  title,
  right,
  back,
}: {
  title: string
  right?: ReactNode
  /** `back` = mũi tên quay lại, `close` = dấu ✕ cho màn dạng form. */
  back?: 'back' | 'close'
}) {
  const navigate = useNavigate()

  return (
    <header className="flex items-center gap-1 border-b border-line bg-white px-2 py-2.5">
      {back ? (
        <button
          type="button"
          onClick={() => void navigate(-1)}
          aria-label="Quay lại"
          className="grid size-12 shrink-0 place-items-center rounded-btn text-[22px] active:bg-surface"
        >
          {back === 'close' ? '✕' : '‹'}
        </button>
      ) : (
        <span className="w-2" />
      )}
      <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold">{title}</h1>
      {right ? <span className="shrink-0 pr-2 text-[13px] text-muted">{right}</span> : null}
    </header>
  )
}
