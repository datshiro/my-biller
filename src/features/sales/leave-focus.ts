/**
 * Ô số lượng trong sheet chỉ chốt `0` (bỏ món) và trả số cũ khi gõ dở "1.000" ở `onBlur`. Sheet bị tháo
 * khỏi cây (Esc, ✕, chạm lớp phủ, sang Giảm giá hay Thu tiền) thì React không gọi `onBlur` cho ô đang
 * focus, và trên iOS chạm nút cũng không lấy focus khỏi ô. Rời ô trước rồi mới đi, để hai bước đó luôn chạy.
 */
export const leaveFocusThen =
  <A extends unknown[]>(next: (...args: A) => void) =>
  (...args: A) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    next(...args)
  }
