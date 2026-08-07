import { Button } from './button'

/** Empty state phải nói việc cần làm, không chỉ báo "trống" (docs/design-guidelines.md). */
export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-8 py-14 text-center">
      <p className="text-muted">{message}</p>
      {actionLabel && onAction ? (
        <Button onClick={onAction}>{actionLabel}</Button>
      ) : null}
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-line px-4 py-4">
          <div className="h-4 flex-1 rounded bg-surface" />
          <div className="h-4 w-20 rounded bg-surface" />
        </div>
      ))}
    </div>
  )
}
