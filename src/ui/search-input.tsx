export function SearchInput({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  /** Enter trên bàn phím mềm. Bỏ trống thì Enter không làm gì. */
  onSubmit?: () => void
  placeholder: string
}) {
  return (
    <div className="px-4 py-3">
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault()
            onSubmit()
          }
        }}
        aria-label={placeholder}
        className="h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand"
      />
    </div>
  )
}
