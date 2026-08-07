import type { ComponentProps, ReactNode } from 'react'
import { useId } from 'react'

export function Field({
  label,
  htmlFor,
  hint,
  warning,
  error,
  children,
}: {
  label: string
  /** Id của ô nhập bên trong. Thiếu nó thì nhãn chỉ là chữ trang trí, screen reader không đọc được ô. */
  htmlFor?: string
  hint?: string
  /** Cảnh báo mềm: nhắc nhưng vẫn cho lưu (ví dụ giá nhập cao hơn giá bán). */
  warning?: string
  error?: string
  children: ReactNode
}) {
  const labelClass = 'label-xs text-muted'

  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children}
      {error ? (
        <p className="text-[13px] font-semibold text-danger">{error}</p>
      ) : warning ? (
        <p className="text-[13px] font-semibold text-warn">{warning}</p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

type TextFieldProps = Omit<ComponentProps<'input'>, 'className' | 'id'> & {
  label: string
  hint?: string
  error?: string
}

export function TextField({ label, hint, error, ...rest }: TextFieldProps) {
  const id = useId()

  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <input
        id={id}
        className={`h-12 w-full rounded-btn border bg-surface px-3 text-[17px] outline-none focus:border-brand ${
          error ? 'border-danger' : 'border-line'
        }`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  )
}
