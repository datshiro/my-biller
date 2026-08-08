/**
 * Vì sao kho dữ liệu không dùng được nữa.
 *
 * `registerType: 'prompt'` (`vite.config.ts:16`) là quyết định cố ý — service worker không tự reload
 * giữa lúc người bán đang lên đơn. Hệ quả: **hai bản JS cùng sống trên một máy là trạng thái bình
 * thường**, không phải tai nạn. Bản cũ có thể gặp một IndexedDB đã được bản mới nâng version; Dexie
 * đóng kết nối và từ đó mọi thao tác ghi đều hỏng, nhưng màn hình vẫn hiện y như cũ. Người bán bấm
 * THU TIỀN mãi mà không có gì xảy ra.
 *
 * Trạng thái ở đây để React dựng một màn chặn **có đường ra**, thay vì để họ bấm vào hư không.
 */
export type DbBlockReason =
  /** Dữ liệu trên máy mới hơn bản app đang chạy. Lối ra: cập nhật app. */
  | 'stale-app'
  /** Một tab khác đang giữ kết nối cũ nên không nâng cấp được. Lối ra: đóng tab kia. */
  | 'other-tab'

let reason: DbBlockReason | null = null
const listeners = new Set<() => void>()

export function blockDb(next: DbBlockReason): void {
  if (reason === next) return
  reason = next
  for (const listener of listeners) listener()
}

export function getDbBlock(): DbBlockReason | null {
  return reason
}

export function subscribeDbBlock(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Chỉ dùng trong test — trạng thái này là module-level nên rò rỉ qua các ca nếu không dọn. */
export function resetDbBlock(): void {
  reason = null
  listeners.clear()
}

/**
 * Những lỗi mà nút "⬇ TẢI FILE SAO LƯU" của `ErrorBoundary` chắc chắn không vượt qua được: nút đó đi
 * qua `exportBackup` → `collectBackup` → `db.transaction`, tức đúng cái Dexie đang hỏng. Hứa một lối
 * thoát bất khả thi còn tệ hơn không hứa gì — người bán bấm, thấy im, rồi hết cách.
 */
const DB_UNAVAILABLE_ERRORS = new Set([
  'VersionError',
  'DatabaseClosedError',
  'UpgradeError',
  'MissingAPIError',
  'InvalidStateError',
])

export function isDbUnavailableError(error: unknown): boolean {
  return error instanceof Error && DB_UNAVAILABLE_ERRORS.has(error.name)
}
