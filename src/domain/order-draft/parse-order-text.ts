import { parseQtyInput } from '../money'

export type ItemCandidate = {
  id: number
  name: string
  unit: string
  unitPrice: number
  costPrice: number | null
}

export type OrderDraftLine = {
  itemId: number
  name: string
  unit: string
  unitPrice: number
  costPrice: number | null
  qty: number
}

/** Bỏ dấu tiếng Việt để so khớp tên: "Phở bò" ~ "pho bo". */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const LEADING_QTY = /^(\d+(?:[.,]\d{1,3})?)\s+(.+)$/

function matchItem(query: string, items: readonly ItemCandidate[]): ItemCandidate | null {
  if (!query) return null

  const exact = items.filter((item) => normalizeName(item.name) === query)
  if (exact.length === 1) return exact[0] ?? null

  const partial = items.filter((item) => normalizeName(item.name).includes(query))
  if (partial.length === 0) return null

  // Nhiều mặt hàng cùng khớp → chọn tên ngắn nhất (sát ý người nói nhất), hoà thì theo id để kết quả ổn định.
  return [...partial].sort((a, b) => a.name.length - b.name.length || a.id - b.id)[0] ?? null
}

/**
 * Chỗ cắm cho nhập bằng giọng nói ở phase sau — GIỮ NGUYÊN chữ ký hàm này.
 * Bản 1 chỉ khớp tên + số lượng đứng đầu: "2 pho bo, 1 tra da" → 2 dòng.
 * Cụm không khớp mặt hàng nào bị bỏ qua; không khớp gì cả thì trả mảng rỗng.
 */
export function parseOrderText(text: string, items: readonly ItemCandidate[]): OrderDraftLine[] {
  const lines: OrderDraftLine[] = []

  // Dấu phẩy vừa là dấu tách món vừa là dấu thập phân của số lượng ("0,5 kg đường").
  // Đổi phẩy nằm giữa hai chữ số thành dấu chấm trước, rồi mới tách món.
  for (const chunk of text.replace(/(\d),(\d)/g, '$1.$2').split(/[\n,;+]/)) {
    const cleaned = chunk.trim()
    if (!cleaned) continue

    const withQty = LEADING_QTY.exec(cleaned)
    const qty = withQty ? parseQtyInput(withQty[1] ?? '') : 1
    // `0` lẫn `null` đều không được thêm dòng: `parseQtyInput` giờ đọc được `0` (nghĩa "bỏ món"), mà
    // ở đây chưa có món nào để bỏ.
    if (!qty) continue

    const item = matchItem(normalizeName(withQty ? (withQty[2] ?? '') : cleaned), items)
    if (!item) continue

    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      qty,
    })
  }

  return lines
}
