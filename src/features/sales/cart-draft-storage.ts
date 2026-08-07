import { z } from 'zod'
import type { Cart } from '@/domain/cart'

const KEY = 'my-biller:cart-draft'

const CartLineSchema = z.object({
  key: z.string(),
  itemId: z.number().int().positive().nullable(),
  name: z.string().min(1),
  unit: z.string(),
  unitPrice: z.number().int().nonnegative(),
  costPrice: z.number().int().nonnegative().nullable(),
  qty: z.number().positive(),
  note: z.string(),
})

const CartSchema = z.object({
  customerId: z.number().int().positive().nullable(),
  customerName: z.string(),
  lines: z.array(CartLineSchema),
  discount: z.number().int().nonnegative(),
  surcharge: z.number().int().nonnegative(),
  note: z.string(),
})

export function saveCartDraft(cart: Cart): void {
  try {
    if (cart.lines.length === 0) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify(cart))
  } catch {
    // Hết dung lượng hoặc trình duyệt chặn localStorage: mất nháp thì tiếc, nhưng chặn bán hàng thì tệ hơn.
  }
}

/**
 * Nháp là dữ liệu ngoài tầm kiểm soát (người dùng sửa tay, bản cũ còn sót, storage hỏng).
 * Parse không qua thì bỏ luôn nháp và mở giỏ rỗng — không bao giờ để app trắng màn vì một nháp hỏng.
 */
export function loadCartDraft(): Cart | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null

    const parsed = CartSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      localStorage.removeItem(KEY)
      return null
    }
    return parsed.data
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
