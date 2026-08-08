import { useEffect } from 'react'

/**
 * Hỏi lại trước khi tải lại trang / đóng tab khi form còn chữ chưa lưu. Trình duyệt hiện hộp thoại
 * của chính nó, không tuỳ biến được nội dung — nhưng nó là thứ duy nhất chắn được nút Tải lại của
 * thanh cập nhật service worker.
 *
 * Nút back cứng của Android **không** chắn được ở đây: `useBlocker` cần data router, mà app đang
 * dùng `BrowserRouter`. Nút ✕ trên đầu màn được `FormScreen` chắn riêng.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
