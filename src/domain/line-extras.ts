import type { LineTopping, OptionGroup, ToppingMenuItem } from './schema'

/**
 * Nhóm tuỳ chọn có sẵn cho MỌI món, không phải một hàng thực đơn phải seed và đồng bộ cho từng nhóm món.
 * Hai nhãn đá loại trừ nhau: một ly không thể vừa đá chung vừa đá riêng, muốn cả hai kiểu thì đó là hai dòng.
 */
export const ICE_OPTION_GROUP: OptionGroup = { name: 'Đá', choices: ['Đá chung', 'Đá riêng'] }

export const optionGroupsFor = (menu: { optionGroups: readonly OptionGroup[] } | undefined): OptionGroup[] => [
  ICE_OPTION_GROUP,
  ...(menu?.optionGroups ?? []),
]

/**
 * Bật/tắt một lựa chọn: bấm lựa chọn khác trong cùng nhóm thì THAY, bấm lại lựa chọn đang chọn thì gỡ.
 * Nhãn của nhóm khác giữ nguyên thứ tự.
 */
export function toggleOption(options: readonly string[], group: OptionGroup, choice: string): string[] {
  const others = options.filter((option) => !group.choices.includes(option))
  return options.includes(choice) ? others : [...others, choice]
}

/** Nhãn đã chọn mà thực đơn không còn nhóm nào chứa (nhóm bị xoá, hoặc đơn cũ). Vẫn phải gỡ được. */
export const orphanOptions = (options: readonly string[], groups: readonly OptionGroup[]): string[] =>
  options.filter((option) => !groups.some((group) => group.choices.includes(option)))

/**
 * Đặt số phần của một topping trên dòng; 0 là gỡ. Topping đã có trên dòng giữ NGUYÊN giá lúc chọn: sửa giá
 * thực đơn giữa chừng không được làm giá của ly đang lên đơn nhảy theo.
 */
export function setToppingQty(
  toppings: readonly LineTopping[],
  item: ToppingMenuItem,
  qty: number,
): LineTopping[] {
  const existing = toppings.find((topping) => topping.name === item.name)
  const rest = toppings.filter((topping) => topping.name !== item.name)
  if (qty <= 0) return rest
  return [...rest, { name: item.name, unitPrice: existing?.unitPrice ?? item.price, qty }]
}

export const toppingLabel = (topping: Pick<LineTopping, 'name' | 'qty'>): string =>
  topping.qty > 1 ? `${topping.name} x${topping.qty}` : topping.name

/** Tiền của một topping cho MỘT ly (giá lúc bán × số phần) — con số hiện cạnh tên topping trên phiếu. */
export const toppingAmount = (topping: Pick<LineTopping, 'unitPrice' | 'qty'>): number => topping.unitPrice * topping.qty

/**
 * Nhóm món có thực đơn RIÊNG (tuỳ chọn hay topping do chủ quán cài). Nhóm Đá có sẵn cho mọi món nên không
 * tính: tính nó thì món nào chạm vào cũng bật sheet hỏi, và Trà đá mất đường một chạm là vào đơn.
 */
export const hasOwnMenu = (
  menu: { optionGroups: readonly OptionGroup[]; toppingMenu: readonly ToppingMenuItem[] } | undefined,
): boolean => (menu?.optionGroups.length ?? 0) > 0 || (menu?.toppingMenu.length ?? 0) > 0

/**
 * Cụm ghi chú ngăn bằng "dấu phẩy + khoảng trắng", không phải dấu phẩy trần: dấu phẩy trần là dấu thập phân
 * ("thêm 1,5 lạng"), tách ở đó là chẻ đôi chữ người bán tự gõ — chữ in lên tem và phiếu.
 */
const NOTE_SEPARATOR = ','
const phrasesOf = (note: string): string[] =>
  note
    .split(/,\s+/)
    .map((phrase) => phrase.trim())
    .filter(Boolean)
const sameKey = (phrase: string) => phrase.toLocaleLowerCase('vi')

export const hasNotePhrase = (note: string, phrase: string): boolean =>
  phrasesOf(note).some((part) => sameKey(part) === sameKey(phrase))

/**
 * Chip ghi chú chỉ thêm hay gỡ ĐÚNG cụm của nó trong ô ghi chú, chữ người bán tự gõ ở các cụm khác giữ
 * nguyên. Ghi chú vẫn là một chuỗi trên dòng, không có trường thứ hai để tem và phiếu phải đọc thêm.
 */
export function toggleNotePhrase(note: string, phrase: string): string {
  const parts = phrasesOf(note)
  const kept = parts.filter((part) => sameKey(part) !== sameKey(phrase))
  return (kept.length === parts.length ? [...parts, phrase.trim()] : kept).join(`${NOTE_SEPARATOR} `)
}

/**
 * Các cụm ghi chú hay dùng nhất trong những ghi chú cho trước (mới nhất trước). Nhiều lần hơn thì đứng
 * trước, hoà thì cụm dùng gần hơn đứng trước; hiện theo cách viết của lần dùng gần nhất.
 *
 * `exclude` là các lựa chọn đã có chip tuỳ chọn riêng. Bản trước 2.8.0 ghi "Đá riêng" / "Đá chung" thẳng vào
 * ghi chú và không được di trú, nên không lọc thì chip ghi chú "Đá riêng" nằm ngay dưới chip tuỳ chọn cùng
 * chữ — chạm nhầm là lách luật loại trừ của nhóm Đá và dòng không gộp với dòng đá riêng thật.
 */
export function recentNotePhrases(
  notesNewestFirst: readonly string[],
  limit: number,
  exclude: readonly string[] = [],
): string[] {
  const excluded = new Set(exclude.map(sameKey))
  const seen = new Map<string, { label: string; count: number; firstAt: number }>()
  notesNewestFirst.forEach((note, index) => {
    for (const phrase of phrasesOf(note)) {
      if (excluded.has(sameKey(phrase))) continue
      const entry = seen.get(sameKey(phrase))
      if (entry) entry.count += 1
      else seen.set(sameKey(phrase), { label: phrase, count: 1, firstAt: index })
    }
  })
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
    .slice(0, limit)
    .map((entry) => entry.label)
}
