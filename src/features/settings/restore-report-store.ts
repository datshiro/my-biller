import { z } from 'zod'
import type { RestoreReport } from '@/domain/backup-report'

/**
 * Khôi phục xong app tự tải lại trang, nên báo cáo đối chiếu phải sống qua lần tải lại đó: ghi vào
 * `sessionStorage` (chỉ tab này, mất khi đóng tab), màn Sao lưu đọc một lần rồi xoá.
 */
const KEY = 'my-biller.restore-report'

const ReportRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  expected: z.number(),
  actual: z.number(),
  matches: z.boolean(),
})

const StoredRestoreReportSchema = z.object({
  mode: z.enum(['overwrite', 'merge']),
  sourceName: z.string(),
  safety: z.object({ savedAs: z.string(), location: z.string(), verified: z.boolean() }).nullable(),
  codeChanges: z.number().int().nonnegative(),
  report: z.object({
    ok: z.boolean(),
    overpaidOrders: z.number().int().nonnegative(),
    rows: z.array(ReportRowSchema),
  }),
})

export type StoredRestoreReport = Omit<z.infer<typeof StoredRestoreReportSchema>, 'report'> & {
  report: Pick<RestoreReport, 'ok' | 'overpaidOrders'> & {
    rows: { key: string; label: string; expected: number; actual: number; matches: boolean }[]
  }
}

export function saveRestoreReport(stored: StoredRestoreReport): void {
  sessionStorage.setItem(KEY, JSON.stringify(stored))
}

/** Khoá hỏng (sửa tay, bản cũ) thì bỏ qua im lặng: dữ liệu đã ghi rồi, mất thẻ báo cáo không mất tiền. */
export function readRestoreReport(): StoredRestoreReport | null {
  const raw = sessionStorage.getItem(KEY)
  if (raw === null) return null
  try {
    const parsed = StoredRestoreReportSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // JSON hỏng — rơi xuống xoá khoá.
  }
  clearRestoreReport()
  return null
}

export function clearRestoreReport(): void {
  sessionStorage.removeItem(KEY)
}
