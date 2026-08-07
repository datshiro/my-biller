import { ScreenHeader } from '@/ui/screen-header'

/** Tạm cho Phase 1 — mỗi màn được thay bằng tính năng thật ở phase tương ứng. */
export function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <ScreenHeader title={title} />
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <p className="text-[15px] text-muted">Màn này được làm ở {phase}.</p>
        <p className="text-[13px] text-faint">
          Khung app, điều hướng và bộ màu đã chạy — kiểm tra được cả khi tắt mạng.
        </p>
      </div>
    </>
  )
}
