/**
 * Xin trình duyệt "ghim" bộ nhớ để hệ điều hành không xoá dữ liệu khi thiếu dung lượng
 * hoặc khi lâu không mở app. Việc này bảo vệ bản sao đọc và hàng đợi chưa đồng bộ trên máy;
 * sổ chung không thay thế cho file sao lưu độc lập.
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
