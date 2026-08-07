/**
 * Chọn tháng bằng hai mũi tên. Không nhận `Date.now()` mà nhận sẵn nhãn và `canNext` — đọc đồng hồ
 * trong lúc render thì mỗi lần vẽ lại ra một kết quả khác; chỗ biết giờ là hook đọc dữ liệu.
 */
export function MonthPicker({
  label,
  canNext,
  onPrev,
  onNext,
}: {
  label: string
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const arrow = 'grid size-12 shrink-0 place-items-center rounded-btn text-[22px] active:bg-surface disabled:opacity-30'

  return (
    <div className="flex items-center">
      <button type="button" aria-label="Tháng trước" onClick={onPrev} className={arrow}>
        ‹
      </button>
      <span className="min-w-[7.5rem] text-center font-semibold">{label}</span>
      <button
        type="button"
        aria-label="Tháng sau"
        onClick={onNext}
        disabled={!canNext}
        className={arrow}
      >
        ›
      </button>
    </div>
  )
}
