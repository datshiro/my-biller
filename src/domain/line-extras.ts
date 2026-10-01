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
