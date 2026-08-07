import { formatVnd } from '@/domain/money'

type Tone = 'ink' | 'brand' | 'warn' | 'danger' | 'muted'

const TONE: Record<Tone, string> = {
  ink: 'text-ink',
  brand: 'text-brand',
  warn: 'text-warn',
  danger: 'text-danger',
  muted: 'text-muted',
}

/** Số tiền luôn tabular-nums để các dòng thẳng cột; số âm tự chuyển sang màu đỏ. */
export function MoneyText({
  value,
  size = 'body',
  tone,
  className = '',
}: {
  value: number
  size?: 'body' | 'lg' | 'xl'
  tone?: Tone
  className?: string
}) {
  const sizing = size === 'xl' ? 'money-xl' : size === 'lg' ? 'money-lg' : 'money font-semibold'
  const resolved = tone ?? (value < 0 ? 'danger' : 'ink')

  return <span className={`${sizing} ${TONE[resolved]} ${className}`}>{formatVnd(value)}</span>
}
