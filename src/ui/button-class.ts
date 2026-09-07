export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
/** `cta` là nút hành động chính ở đáy màn: cao 56px, full width (docs/design-guidelines.md). */
export type ButtonSize = 'md' | 'cta'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white active:bg-brand-press',
  secondary: 'bg-surface text-ink border border-line active:bg-line',
  danger: 'bg-danger-tint text-danger border border-danger/25 active:bg-danger/15',
  ghost: 'text-brand active:bg-brand-tint',
}

/**
 * Ghép class của `<Button>`, tách khỏi `button.tsx` để `<a data-rawbt>` (nút in RawBT) dùng chung diện
 * mạo nút mà không phải export hàm từ file component — export thêm từ đó vấp `react-refresh/only-export-components`
 * (tiền lệ `ice-note.ts`).
 */
export function buttonClassName(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  const sizing = size === 'cta' ? 'h-14 w-full text-[17px] font-bold' : 'h-12 px-4 font-semibold'
  return `inline-flex items-center justify-center gap-2 rounded-btn transition-colors disabled:opacity-40 ${sizing} ${VARIANT[variant]} ${extra}`
}
