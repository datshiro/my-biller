import { z } from 'zod'
import type { Cart } from '@/domain/cart'

const KEY = 'my-biller:cart-draft'

/**
 * Dấu của **lần nạp trang hiện tại**. Module chỉ chạy lại khi trang được nạp lại — đóng app mở lại, tải
 * lại, app tự cập nhật — nên nháp mang dấu khác dấu này đúng là nháp phiên trước để lại. Bấm sang màn
 * khác rồi quay lại màn Bán hàng không nạp lại trang, nên vẫn cùng dấu.
 */
const SESSION = String(Math.random())

function sessionOf(raw: unknown): string | null {
  return raw !== null && typeof raw === 'object' && 'sessionId' in raw && typeof raw.sessionId === 'string'
    ? raw.sessionId
    : null
}

/**
 * Ba trường của bảng giá riêng đều **có đường rơi về**, vì mọi nháp đang nằm trong máy người bán đều do
 * bản build cũ ghi và thiếu cả ba. Thiếu mà parse đỏ thì `loadCartDraft` xoá sạch nháp *và* banner "Đã
 * khôi phục đơn đang lên dở" cũng không hiện: người bán đang lên đơn 12 dòng, app tự cập nhật, mở lại
 * thấy giỏ trắng, không một dòng thông báo.
 *
 * `priceSource` rơi về **`'manual'`** chứ không `'catalog'`: dòng cũ không biết giá lẻ gốc là bao nhiêu,
 * nên coi nó là "người bán tự đặt, đừng đụng vào" mới là phía an toàn.
 *
 * `retailPrice` vá ngay tại cửa nạp bằng `unitPrice` thay vì để `undefined` chảy vào domain — nhờ vậy
 * `CartLine.retailPrice` luôn là số, không có nhánh `undefined` nào phải đỡ ở mọi chỗ dùng về sau.
 */
const CartLineSchema = z
  .object({
    key: z.string(),
    itemId: z.number().int().positive().nullable(),
    name: z.string().min(1),
    unit: z.string(),
    unitPrice: z.number().int().nonnegative(),
    retailPrice: z.number().int().nonnegative().optional(),
    priceSource: z.enum(['catalog', 'manual']).default('manual'),
    costPrice: z.number().int().nonnegative().nullable(),
    qty: z.number().positive(),
    note: z.string(),
  })
  .transform((line) => ({ ...line, retailPrice: line.retailPrice ?? line.unitPrice }))

const CartSchema = z.object({
  customerId: z.number().int().positive().nullable(),
  customerName: z.string(),
  lines: z.array(CartLineSchema),
  discount: z.number().int().nonnegative(),
  surcharge: z.number().int().nonnegative(),
  note: z.string(),
  priceMode: z.enum(['retail', 'wholesale']).default('retail'),
})

export function saveCartDraft(cart: Cart): void {
  try {
    if (cart.lines.length === 0) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify({ ...cart, sessionId: SESSION }))
  } catch {
    // Hết dung lượng hoặc trình duyệt chặn localStorage: mất nháp thì tiếc, nhưng chặn bán hàng thì tệ hơn.
  }
}

/**
 * Nháp là dữ liệu ngoài tầm kiểm soát (người dùng sửa tay, bản cũ còn sót, storage hỏng).
 * Parse không qua thì bỏ luôn nháp và mở giỏ rỗng — không bao giờ để app trắng màn vì một nháp hỏng.
 *
 * Trả kèm `fromEarlierSession` vì mỗi lần dựng lại màn Bán hàng đều nạp lại nháp, mà chỉ nháp của phiên
 * trước mới đáng báo cho người bán. Nháp do bản build cũ ghi chưa có dấu phiên nào, tính là phiên trước.
 */
export function loadCartDraft(): { cart: Cart; fromEarlierSession: boolean } | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null

    const json: unknown = JSON.parse(raw)
    const parsed = CartSchema.safeParse(json)
    if (!parsed.success) {
      localStorage.removeItem(KEY)
      return null
    }
    return { cart: parsed.data, fromEarlierSession: sessionOf(json) !== SESSION }
  } catch {
    localStorage.removeItem(KEY)
    return null
  }
}

export function clearCartDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Xoá không được thì lần mở sau sẽ khôi phục nháp cũ — khó chịu nhưng không mất dữ liệu.
  }
}
