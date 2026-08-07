import type { ReactNode } from 'react'

type Tone = 'neutral' | 'brand' | 'warn' | 'danger'

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface text-muted',
  brand: 'bg-brand-tint text-brand',
  warn: 'bg-warn-tint text-warn',
  danger: 'bg-danger-tint text-danger',
}

/** Nhãn trạng thái. Luôn có CHỮ, không chỉ màu — người mù màu vẫn phải đọc được. */
export function StatusChip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export function SelectChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      // Giữ nguyên bề ngang chữ: hàng chip nào chật thì cuộn ngang, không bóp chữ xuống hai dòng.
      className={`h-12 shrink-0 whitespace-nowrap rounded-full border px-4 font-semibold ${
        selected ? 'border-brand bg-brand-tint text-brand' : 'border-line bg-white text-ink'
      }`}
    >
      {children}
    </button>
  )
}
