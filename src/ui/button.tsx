import type { ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-press',
  secondary: 'bg-surface text-ink border border-line active:bg-line',
  danger: 'bg-danger-tint text-danger border border-danger/25 active:bg-danger/15',
  ghost: 'text-brand active:bg-brand-tint',
}

type Props = ComponentProps<'button'> & {
  variant?: Variant
  /** `cta` là nút hành động chính ở đáy màn: cao 56px, full width (docs/design-guidelines.md). */
  size?: 'md' | 'cta'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  const sizing = size === 'cta' ? 'h-14 w-full text-[17px] font-bold' : 'h-12 px-4 font-semibold'

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-btn transition-colors disabled:opacity-40 ${sizing} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
}
