import { useEffect, useReducer, useRef, useState } from 'react'
import { clearCartDraft, loadCartDraft, saveCartDraft } from './cart-draft-storage'
import { cartReducer, emptyCart, type Cart, type CartAction } from '@/domain/cart'

const SAVE_DELAY_MS = 300

export function useCart(): {
  cart: Cart
  dispatch: (action: CartAction) => void
  /** Xoá giỏ VÀ nháp đã lưu. Gọi sau khi ghi đơn thành công, hoặc khi người bán bỏ đơn dở. */
  reset: () => void
  /**
   * Giỏ mở ra từ nháp của **phiên trước** — đóng app mở lại, tải lại trang, app tự cập nhật. Để báo cho
   * người bán biết vì sao có sẵn hàng trong đơn. Bấm sang màn khác rồi quay lại cũng nạp lại nháp, nhưng
   * đó là giỏ họ vừa để lại chứ không phải chuyện cần báo.
   */
  restored: boolean
} {
  // Đọc nháp ngay lúc dựng state, không qua effect: khôi phục là giá trị khởi tạo chứ không phải
  // một lần cập nhật sau khi đã vẽ giỏ rỗng.
  const [draft] = useState(loadCartDraft)
  // Nháp đi qua `restore` chứ không nạp thẳng: đó là chỗ khoá dòng được tính lại. Nạp thẳng thì nháp
  // do bản build cũ ghi giữ nguyên khoá cũ và mọi lần chạm sau đó đẻ ra dòng thứ hai thay vì cộng dồn.
  const [cart, dispatch] = useReducer(cartReducer, draft, (seed) =>
    seed ? cartReducer(emptyCart(), { type: 'restore', cart: seed.cart }) : emptyCart(),
  )
  const [restored, setRestored] = useState(draft?.fromEarlierSession ?? false)

  const latestCart = useRef(cart)

  useEffect(() => {
    latestCart.current = cart
    const timer = setTimeout(() => saveCartDraft(cart), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [cart])

  /**
   * Rời màn Bán hàng lúc giờ hẹn chưa nổ thì `clearTimeout` ở trên huỷ luôn lượt ghi, và mọi thay đổi
   * trong 300ms cuối biến mất không một dấu vết — chạm thêm một món rồi bấm sang màn khác là món đó
   * không bao giờ vào nháp. Ghi nốt lúc gỡ màn để đóng cửa sổ đó.
   *
   * Đọc qua ref chứ không đưa `cart` vào mảng phụ thuộc: để `cart` vào là effect chạy lại mỗi lần giỏ
   * đổi, tức ghi thẳng mỗi lần chạm và vô hiệu hoá đúng cái debounce vừa đặt ở trên.
   */
  useEffect(() => () => saveCartDraft(latestCart.current), [])

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
