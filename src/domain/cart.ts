import { calcLineAmount, calcOrderTotals, type OrderTotals } from './order-total'
import { resolveUnitPrice, type PriceBook, type PriceMode } from './wholesale-price'
import type { Item } from './schema'

/** Một dòng trong giỏ. Giá và tên đã tách khỏi `items` ngay lúc thêm — sửa giá tại đây không đụng danh mục. */
export type CartLine = {
  /** Khoá cục bộ của dòng giỏ. Cùng một mặt hàng có thể nằm hai dòng nếu bán hai giá khác nhau. */
  key: string
  itemId: number | null
  name: string
  unit: string
  unitPrice: number
  /**
   * Giá lẻ chụp lại lúc dòng vào giỏ. Là chỗ `applyPriceMode` rơi về khi tắt SỈ, nên nó phải nằm **trên
   * dòng** chứ không đọc lại từ danh mục: đọc lại thì sửa giá ở màn Mặt hàng sẽ làm giá trong giỏ nhảy
   * theo, phá đúng cái invariant ghi ở đầu file này.
   */
  retailPrice: number
  /**
   * Giá này ở đâu ra. **Không suy được từ con số**: đang bán SỈ cho khách A rồi đổi sang khách B, giá
   * của A khác giá danh mục nên phép so-giá sẽ đoán nhầm là người bán gõ tay và đóng băng giá của A vào
   * đơn của B. Phải ghi lại ngay lúc dòng sinh ra.
   */
  priceSource: 'catalog' | 'manual'
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
  priceMode: PriceMode
}

export type CartAction =
  /** `book` bắt buộc, **không có giá trị mặc định**: quên truyền là typecheck đỏ, không phải âm thầm bán giá lẻ. */
  | { type: 'addItem'; item: Item; qty?: number; book: PriceBook }
  | {
      type: 'addLine'
      line: Omit<CartLine, 'key' | 'note' | 'priceSource' | 'retailPrice'> & { note?: string }
      book: PriceBook
    }
  /**
   * Đặt lại nguyên trạng một dòng vừa bị gỡ (nút Hoàn lại). Cố ý KHÔNG đi qua `addLine`: `addLine`
   * tính lại `unitPrice` theo chế độ giá hiện hành và ép `priceSource: 'catalog'`, nên dòng
   * giá-gõ-tay sẽ bị bảng giá sỉ đè mất giá riêng. Hoàn lại mà đổi tiền thì không phải hoàn lại.
   */
  | { type: 'restoreLine'; line: CartLine }
  /** Đổi giá **cả giỏ** một lượt. Payload cố ý không mang danh mục — xem `retailPrice`. */
  | { type: 'applyPriceMode'; mode: PriceMode; book: PriceBook }
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
  priceMode: 'retail',
})

/**
 * Khoá dòng gộp theo mặt hàng + đơn giá: chạm ô mặt hàng nhiều lần thì cộng dồn số lượng,
 * nhưng nếu người bán đã sửa giá riêng cho một dòng thì lần chạm sau tạo dòng mới thay vì đè giá cũ.
 *
 * `priceSource` nằm trong khoá vì **`upsert` giữ bản ghi đang có và chỉ cộng `qty`**, tức mọi trường của
 * dòng tới đều bị bỏ. Không có nó thì: giỏ có 1 tô gõ tay 38.000 + 3 tô giá lẻ 55.000, bật SỈ đúng giá
 * 38.000 → dòng catalog trùng khoá dòng manual → gộp thành 1 dòng `manual` qty 4. Tắt SỈ không đụng dòng
 * manual, nên 4 tô bán 38.000 thay vì 1×38.000 + 3×55.000: **mất 51.000đ, không một lỗi nào hiện ra**.
 *
 * `note` nằm CUỐI khoá để 3 ly đá chung và 2 ly đá riêng của cùng một món cùng một giá tách được thành
 * hai dòng. Đặt cuối và ngăn bằng `~` là đủ chống nhập nhằng: mọi trường phía trước có khuôn cố định và
 * `priceSource` là enum không chứa `~`, nên ghi chú tự do không lấn được sang trường nào.
 */
const lineKey = (
  itemId: number | null,
  name: string,
  unitPrice: number,
  priceSource: CartLine['priceSource'],
  note: string,
) => `${itemId ?? `x:${name}`}@${unitPrice}#${priceSource}~${note}`

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

/**
 * Như `mapLine`, nhưng dành cho thay đổi làm ĐỔI KHOÁ (giá hoặc ghi chú). Nếu khoá mới đụng một dòng
 * khác thì gộp lại, vì để hai bản ghi mang chung một khoá là mở cửa cho `mapLine`/`removeLine` tác
 * động cả hai cùng lúc.
 *
 * Dòng sống sót giữ MỌI TRƯỜNG của dòng vừa sửa, không của dòng bị đụng — cố ý ngược khuôn `upsert`:
 * người bán vừa nói ra ý định của mình trên đúng dòng này. Ca B5b khoá lựa chọn đó bằng test.
 */
function mapLineRekey(
  lines: CartLine[],
  key: string,
  change: (line: CartLine) => CartLine,
): CartLine[] {
  const at = lines.findIndex((line) => line.key === key)
  const target = lines[at]
  if (!target) return lines

  const changed = change(target)
  // Gác bằng CHỈ SỐ chứ không bằng so khoá: mở sheet rồi bấm XONG mà không đổi gì thì khoá mới bằng
  // khoá cũ, so khoá sẽ bắt trúng chính nó và nhân đôi số lượng.
  const hit = lines.findIndex((line, index) => index !== at && line.key === changed.key)
  const collision = lines[hit]
  if (!collision) return lines.map((line, index) => (index === at ? changed : line))

  const merged = { ...changed, qty: changed.qty + collision.qty }
  return lines.flatMap((line, index) => {
    if (index === at) return [merged]
    if (index === hit) return []
    return [line]
  })
}

/** Tách ghi chú thành từng nhãn. Khớp NGUYÊN phần tử — `includes` sẽ coi "Đá chung nhiều" là có nhãn
 *  "Đá chung" và làm hỏng luật loại trừ ở sheet sửa dòng. */
const noteTokens = (note: string): string[] =>
  note
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/**
 * Bật/tắt một nhãn trong ghi chú dòng, giữ nguyên phần người bán tự gõ. Là toggle **thuần**: nó không
 * biết luật nghiệp vụ nào (ví dụ hai nhãn đá loại trừ nhau) — luật đó thuộc về chỗ dựng giao diện.
 */
export function toggleNoteToken(note: string, token: string): string {
  const tokens = noteTokens(note)
  const next = tokens.includes(token) ? tokens.filter((part) => part !== token) : [...tokens, token]
  return next.join(', ')
}

export const hasNoteToken = (note: string, token: string): boolean => noteTokens(note).includes(token)

/**
 * Người bán tự đặt giá cho một dòng ⇒ dòng đó thành `manual` và từ đó `applyPriceMode` không đụng vào
 * nữa. Chỉ đổi khi giá **thật sự khác**: mở sheet sửa rồi bấm lưu mà không đổi giá thì dòng vẫn là giá
 * danh mục, bật/tắt SỈ vẫn hoàn nguyên được.
 */
function withPrice(line: CartLine, unitPrice: number): CartLine {
  const priceSource = unitPrice === line.unitPrice ? line.priceSource : 'manual'
  return {
    ...line,
    unitPrice,
    priceSource,
    key: lineKey(line.itemId, line.name, unitPrice, priceSource, line.note),
  }
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    // Hai đường thêm món đi qua **cùng một chỗ** resolve giá: để call site tự nhớ gọi là để nó quên.
    case 'addItem': {
      const { item, qty = 1, book } = action
      if (item.id === undefined) throw new Error('Mặt hàng chưa lưu thì chưa thêm vào giỏ được.')
      // Khoan dung chứ không ném, khác dòng trên: `qty <= 0` là bất biến chung của giỏ, và hai đường
      // chèn còn lại (`addLine`, `restoreLine`) cũng xử bằng `return cart`. Ném ở đây là ném giữa
      // thân render. Món chưa lưu thì khác — đó là lỗi lập trình không có nghĩa nghiệp vụ nào.
      if (qty <= 0) return cart

      const retailPrice = item.unitPrice
      const unitPrice = resolveUnitPrice({ itemId: item.id, retailPrice }, cart.priceMode, book)
      return {
        ...cart,
        lines: upsert(cart.lines, {
          key: lineKey(item.id, item.name, unitPrice, 'catalog', ''),
          itemId: item.id,
          name: item.name,
          unit: item.unit,
          unitPrice,
          retailPrice,
          priceSource: 'catalog',
          costPrice: item.costPrice,
          qty,
          note: '',
        }),
      }
    }

    case 'restoreLine':
      // Cùng bất biến với `addLine`/`setQty`/`updateLine`: không đường chèn nào được phép để lọt
      // qty <= 0. Mở một action mới mà không gác là mở lại đúng cái lỗ vừa bịt.
      if (action.line.qty <= 0) return cart
      // Dòng đã quay lại giỏ rồi thì hoàn lại là KHÔNG LÀM GÌ, không phải cộng thêm. `upsert` cộng
      // dồn qty, nên bỏ nhánh này là biến nút Hoàn lại thành nút nhân đôi số lượng: bỏ 3 tô, chạm
      // lại món 3 lần, rồi bấm Hoàn lại theo quán tính ⇒ đơn ghi 6 tô.
      if (cart.lines.some((line) => line.key === action.line.key)) return cart
      return { ...cart, lines: upsert(cart.lines, action.line) }

    case 'addLine': {
      const { line, book } = action
      // Bất biến "không dòng giỏ nào có qty <= 0" phải toàn phần, không phụ thuộc call site nhớ chặn.
      // Mọi đường chèn đều gác: `setQty`, `updateLine`, `addItem`, `restoreLine` và chỗ này.
      if (line.qty <= 0) return cart
      const retailPrice = line.unitPrice
      const unitPrice = resolveUnitPrice({ itemId: line.itemId, retailPrice }, cart.priceMode, book)
      // Món ngoài danh mục không có giá riêng nào để tra, và cũng không có giá lẻ để quay về.
      const priceSource = line.itemId === null ? 'manual' : 'catalog'
      return {
        ...cart,
        lines: upsert(cart.lines, {
          ...line,
          key: lineKey(line.itemId, line.name, unitPrice, priceSource, line.note ?? ''),
          unitPrice,
          retailPrice,
          priceSource,
          note: line.note ?? '',
        }),
      }
    }

    case 'applyPriceMode': {
      const { mode, book } = action
      const lines = cart.lines.reduce<CartLine[]>((acc, line) => {
        // Nối thẳng, không qua `upsert`: dòng người bán tự đặt giá thì **cả giá lẫn qty** phải nguyên vẹn.
        if (line.priceSource === 'manual' || line.itemId === null) return [...acc, line]

        const unitPrice = resolveUnitPrice(line, mode, book)
        return upsert(acc, {
          ...line,
          unitPrice,
          key: lineKey(line.itemId, line.name, unitPrice, 'catalog', line.note),
        })
      }, [])

      return { ...cart, priceMode: mode, lines }
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
      // Đổi giá là đổi luôn khoá dòng, nếu không hai dòng cùng mặt hàng sẽ đụng khoá nhau.
      return {
        ...cart,
        lines: mapLineRekey(cart.lines, action.key, (line) => withPrice(line, action.unitPrice)),
      }

    // HIỆN CHƯA CÓ CONSUMER nào trong app — sheet sửa dòng gửi `updateLine`. Giữ lại vì nó là đường
    // đổi ghi chú duy nhất không đụng tới giá; nếu đi tìm chỗ gọi thì đừng tìm nữa, không có.
    // Đặt note TRƯỚC rồi mới qua `withPrice`: khoá phải tính theo ghi chú mới, và truyền đúng giá cũ
    // nên `priceSource` không bị đổi.
    case 'setLineNote':
      return {
        ...cart,
        lines: mapLineRekey(cart.lines, action.key, (line) =>
          withPrice({ ...line, note: action.note }, line.unitPrice),
        ),
      }

    case 'updateLine': {
      if (action.qty <= 0) return cartReducer(cart, { type: 'removeLine', key: action.key })
      return {
        ...cart,
        lines: mapLineRekey(cart.lines, action.key, (line) => ({
          ...withPrice({ ...line, note: action.note }, action.unitPrice),
          qty: action.qty,
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
      // Tính lại khoá: nháp do bản build cũ ghi mang khoá thiếu `#priceSource`, giữ nguyên thì lần chạm
      // sau vào đúng món đúng giá lại đẻ ra dòng thứ hai thay vì cộng dồn.
      return {
        ...action.cart,
        lines: action.cart.lines.map((line) => ({
          ...line,
          note: line.note ?? '',
          key: lineKey(line.itemId, line.name, line.unitPrice, line.priceSource, line.note ?? ''),
        })),
      }

    case 'clear':
      return emptyCart()
  }
}

export function cartTotals(cart: Cart): OrderTotals {
  const lines = cart.lines.map((line) => ({ amount: calcLineAmount(line) }))
  return calcOrderTotals({ lines, discount: cart.discount, surcharge: cart.surcharge })
}

export const cartCount = (cart: Cart): number => cart.lines.reduce((sum, line) => sum + line.qty, 0)
