import type { ReactNode } from 'react'
import { ScreenHeader } from './screen-header'

/**
 * Màn danh sách có bottom nav (nav do AppLayout dựng).
 * CTA dùng `sticky` trong vùng cuộn nên luôn nằm trên nav, không cần tính chiều cao nav bằng tay.
 */
export function ListScreen({
  title,
  count,
  cta,
  children,
}: {
  title: string
  count?: ReactNode
  cta?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={title} back="back" right={count} />
      <div className="flex-1">{children}</div>
      {cta ? (
        <div className="sticky bottom-0 border-t border-line bg-white px-4 py-3">{cta}</div>
      ) : null}
    </div>
  )
}
