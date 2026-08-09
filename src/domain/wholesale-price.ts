import type { CartLine } from './cart'

/** Chế độ giá của **cả đơn**, không phải của từng dòng. */
export type PriceMode = 'retail' | 'wholesale'

/**
 * `itemId` → đơn giá riêng của khách đang chọn. Món không có mặt trong map là món khách này chưa được
 * đặt giá riêng, tức bán giá lẻ. Chỉ **2 tầng**: giá riêng → giá lẻ. Không có tầng "giá sỉ chung".
 */
export type PriceBook = Map<number, number>

/**
 * `??` chứ không `||`: giá riêng **`0` là giá thật** (hàng tặng kèm, khuyến mãi), rơi về giá lẻ ở đó là
 * tính tiền một món mà người bán đã quyết định cho không.
 *
 * `retailPrice` là ảnh chụp giá lẻ lúc dòng vào giỏ, không phải giá đọc lại từ danh mục — nhờ vậy hàm
 * này không cần danh mục, không vỡ khi món đã "Ngừng bán", và bật/tắt SỈ luôn về đúng chỗ cũ kể cả khi
 * người bán vừa sửa giá lẻ ở màn Mặt hàng.
 */
export function resolveUnitPrice(
  line: Pick<CartLine, 'itemId' | 'retailPrice'>,
  mode: PriceMode,
  book: PriceBook,
): number {
  if (mode !== 'wholesale' || line.itemId === null) return line.retailPrice
  return book.get(line.itemId) ?? line.retailPrice
}
