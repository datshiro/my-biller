import { useEffect, useReducer, useState } from 'react'
import { clearCartDraft, loadCartDraft, saveCartDraft } from './cart-draft-storage'
import { cartReducer, emptyCart, type Cart, type CartAction } from '@/domain/cart'

const SAVE_DELAY_MS = 300

export function useCart(): {
  cart: Cart
  dispatch: (action: CartAction) => void
  /** Xoá giỏ VÀ nháp đã lưu. Gọi sau khi ghi đơn thành công, hoặc khi người bán bỏ đơn dở. */
  reset: () => void
  /** Giỏ lúc mở app được khôi phục từ nháp — để báo cho người bán biết vì sao có sẵn hàng trong đơn. */
  restored: boolean
} {
  // Đọc nháp ngay lúc dựng state, không qua effect: khôi phục là giá trị khởi tạo chứ không phải
  // một lần cập nhật sau khi đã vẽ giỏ rỗng.
  const [draft] = useState(loadCartDraft)
  // Nháp đi qua `restore` chứ không nạp thẳng: đó là chỗ khoá dòng được tính lại. Nạp thẳng thì nháp
  // do bản build cũ ghi giữ nguyên khoá cũ và mọi lần chạm sau đó đẻ ra dòng thứ hai thay vì cộng dồn.
  const [cart, dispatch] = useReducer(cartReducer, draft, (seed) =>
    seed ? cartReducer(emptyCart(), { type: 'restore', cart: seed }) : emptyCart(),
  )
  const [restored, setRestored] = useState(draft !== null)

  useEffect(() => {
    const timer = setTimeout(() => saveCartDraft(cart), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [cart])

  return {
    cart,
    dispatch,
    reset: () => {
      clearCartDraft()
      dispatch({ type: 'clear' })
      setRestored(false)
    },
    restored,
  }
}
