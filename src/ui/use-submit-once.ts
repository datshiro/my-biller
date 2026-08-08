import { useRef, useState } from 'react'

/**
 * Một lượt ghi, một lần. Chốt bằng ref chứ không dựa vào `disabled`: thuộc tính disabled chỉ có hiệu
 * lực sau khi React vẽ lại, nên hai cú chạm rơi vào cùng một nhịp sẽ lọt cả hai và ghi hai bản.
 *
 * Ghi xong **không** mở khoá lại: mọi chỗ dùng đều đóng sheet hoặc rời màn ngay sau đó, mở khoá chỉ
 * tạo thêm khe cho cú chạm thứ hai. Chỉ nhánh lỗi mới mở khoá để người bán thử lại được.
 *
 * Vì vậy **chỉ dùng ở màn hình hoặc sheet biến mất sau khi lưu thành công**. Gắn vào một form ở lại
 * trên màn (lưu xong vẫn sửa tiếp được) thì nút chết cứng sau lượt lưu đầu, mà không có gì báo cho
 * người bán biết vì sao — cần chỗ như vậy thì đừng dùng hook này.
 */
export function useSubmitOnce(fallbackMessage = 'Không lưu được. Thử lại.') {
  const busy = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try {
      await task()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallbackMessage)
      setSubmitting(false)
      busy.current = false
    }
  }

  return { submitting, error, setError, run }
}
