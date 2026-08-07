import { calcLineAmount, calcOrderTotals, type OrderTotals } from './order-total'
import type { Item } from './schema'

/** Một dòng trong giỏ. Giá và tên đã tách khỏi `items` ngay lúc thêm — sửa giá tại đây không đụng danh mục. */
export type CartLine = {
  /** Khoá cục bộ của dòng giỏ. Cùng một mặt hàng có thể nằm hai dòng nếu bán hai giá khác nhau. */
  key: string
  itemId: number | null
  name: string
  unit: string
  unitPrice: number
  costPrice: number | null
  qty: number
  note: string
}

export type Cart = {
  customerId: number | null
  customerName: string
  lines: CartLine[]
  discount: number
  surcharge: number
  note: string
}

export type CartAction =
  | { type: 'addItem'; item: Item; qty?: number }
  | { type: 'addLine'; line: Omit<CartLine, 'key' | 'note'> & { note?: string } }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'bumpQty'; key: string; delta: number }
  | { type: 'setUnitPrice'; key: string; unitPrice: number }
  | { type: 'setLineNote'; key: string; note: string }
  /** Sửa cả dòng một nhát. Đổi giá làm đổi khoá dòng, nên sửa từng phần rời sẽ trượt khoá. */
  | { type: 'updateLine'; key: string; qty: number; unitPrice: number; note: string }
  | { type: 'removeLine'; key: string }
  | { type: 'setCustomer'; customerId: number | null; customerName: string }
  | { type: 'setDiscount'; discount: number }
  | { type: 'setSurcharge'; surcharge: number }
  | { type: 'setNote'; note: string }
  | { type: 'restore'; cart: Cart }
  | { type: 'clear' }

export const KHACH_LE = 'Khách lẻ'

export const emptyCart = (): Cart => ({
  customerId: null,
  customerName: '',
  lines: [],
  discount: 0,
  surcharge: 0,
  note: '',
})

/**
 * Khoá dòng gộp theo mặt hàng + đơn giá: chạm ô mặt hàng nhiều lần thì cộng dồn số lượng,
 * nhưng nếu người bán đã sửa giá riêng cho một dòng thì lần chạm sau tạo dòng mới thay vì đè giá cũ.
 */
const lineKey = (itemId: number | null, name: string, unitPrice: number) =>
  `${itemId ?? `x:${name}`}@${unitPrice}`

function upsert(lines: CartLine[], incoming: CartLine): CartLine[] {
  const at = lines.findIndex((line) => line.key === incoming.key)
  if (at === -1) return [...lines, incoming]

  const existing = lines[at]
  if (!existing) return [...lines, incoming]

  const merged = { ...existing, qty: existing.qty + incoming.qty }
  return lines.map((line, index) => (index === at ? merged : line))
}

const mapLine = (lines: CartLine[], key: string, change: (line: CartLine) => CartLine) =>
  lines.map((line) => (line.key === key ? change(line) : line))

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'addItem': {
      const { item, qty = 1 } = action
      if (item.id === undefined) throw new Error('Mặt hàng chưa lưu thì chưa thêm vào giỏ được.')
      return {
        ...cart,
        lines: upsert(cart.lines, {
          key: lineKey(item.id, item.name, item.unitPrice),
          itemId: item.id,
          name: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
          costPrice: item.costPrice,
          qty,
          note: '',
        }),
      }
    }

    case 'addLine': {
      const { line } = action
      return {
        ...cart,
        lines: upsert(cart.lines, {
          ...line,
          key: lineKey(line.itemId, line.name, line.unitPrice),
          note: line.note ?? '',
        }),
      }
    }

    case 'setQty':
      return action.qty <= 0
        ? cartReducer(cart, { type: 'removeLine', key: action.key })
        : { ...cart, lines: mapLine(cart.lines, action.key, (line) => ({ ...line, qty: action.qty })) }

    case 'bumpQty': {
      const target = cart.lines.find((line) => line.key === action.key)
      if (!target) return cart
      return cartReducer(cart, { type: 'setQty', key: action.key, qty: target.qty + action.delta })
    }

    case 'setUnitPrice':
      return {
        ...cart,
        // Đổi giá là đổi luôn khoá dòng, nếu không hai dòng cùng mặt hàng sẽ đụng khoá nhau.
        lines: mapLine(cart.lines, action.key, (line) => ({
          ...line,
          unitPrice: action.unitPrice,
          key: lineKey(line.itemId, line.name, action.unitPrice),
        })),
      }

    case 'setLineNote':
      return { ...cart, lines: mapLine(cart.lines, action.key, (line) => ({ ...line, note: action.note })) }

    case 'updateLine': {
      if (action.qty <= 0) return cartReducer(cart, { type: 'removeLine', key: action.key })
      return {
        ...cart,
        lines: mapLine(cart.lines, action.key, (line) => ({
          ...line,
          qty: action.qty,
          unitPrice: action.unitPrice,
          note: action.note,
          key: lineKey(line.itemId, line.name, action.unitPrice),
        })),
      }
    }

    case 'removeLine':
      return { ...cart, lines: cart.lines.filter((line) => line.key !== action.key) }

    case 'setCustomer':
      return { ...cart, customerId: action.customerId, customerName: action.customerName }

    case 'setDiscount':
      return { ...cart, discount: action.discount }

    case 'setSurcharge':
      return { ...cart, surcharge: action.surcharge }

    case 'setNote':
      return { ...cart, note: action.note }

    case 'restore':
      return action.cart

    case 'clear':
      return emptyCart()
  }
}

export function cartTotals(cart: Cart): OrderTotals {
  const lines = cart.lines.map((line) => ({ amount: calcLineAmount(line) }))
  return calcOrderTotals({ lines, discount: cart.discount, surcharge: cart.surcharge })
}

export const cartCount = (cart: Cart): number => cart.lines.reduce((sum, line) => sum + line.qty, 0)
