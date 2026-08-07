import type { ReactNode } from 'react'

/** Một dòng danh sách chạm được: cao tối thiểu 48px theo ngưỡng chạm trong design guidelines. */
export function ListRow({
  title,
  subtitle,
  right,
  onClick,
}: {
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold">{title}</span>
        {subtitle ? <span className="block truncate text-[13px] text-muted">{subtitle}</span> : null}
      </span>
      {right ? <span className="shrink-0 text-right">{right}</span> : null}
    </>
  )

  if (!onClick) {
    return <div className="flex min-h-12 items-center gap-3 border-b border-line px-4 py-3">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 border-b border-line px-4 py-3 text-left active:bg-surface"
    >
      {content}
    </button>
  )
}
