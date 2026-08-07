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
  const [cart, dispatch] = useReducer(cartReducer, draft ?? emptyCart())
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
