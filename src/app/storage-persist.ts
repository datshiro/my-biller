/**
 * Xin trình duyệt "ghim" bộ nhớ để hệ điều hành không xoá dữ liệu khi thiếu dung lượng
 * hoặc khi lâu không mở app. App không có backend nên đây là lớp phòng vệ đầu tiên;
 * lớp thứ hai là sao lưu ra file (Phase 9).
 *
 * Chrome/Safari chỉ chấp nhận khi có tương tác thật của người dùng → chờ gesture đầu tiên.
 */

const STATUS_KEY = 'my-biller.storage-persisted'

export function readPersistedFlag(): boolean {
  return localStorage.getItem(STATUS_KEY) === 'true'
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false

  const granted = (await navigator.storage.persisted()) || (await navigator.storage.persist())
  localStorage.setItem(STATUS_KEY, String(granted))
  return granted
}

/** Gắn listener một lần; trả về hàm dọn dẹp cho useEffect. */
export function requestPersistentStorageOnFirstGesture(): () => void {
  const onGesture = () => {
    void requestPersistentStorage()
  }
  document.addEventListener('pointerdown', onGesture, { once: true })
  return () => document.removeEventListener('pointerdown', onGesture)
}
