import { ICE_OPTION_GROUP } from './line-extras'
import type { OptionGroup, ToppingMenuItem } from './schema'

export type OptionGroupDraft = { name: string; choicesText: string }
export type ToppingDraft = { name: string; price: number | null }

type MenuResult =
  | { ok: true; optionGroups: OptionGroup[]; toppingMenu: ToppingMenuItem[] }
  | { ok: false; error: string }

const key = (text: string) => text.trim().toLocaleLowerCase('vi')

/** Lựa chọn nhập một dòng, cách nhau bằng dấu phẩy hoặc xuống dòng. */
const splitChoices = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)

/**
 * Chuyển bản nhập tay thành thực đơn của một nhóm món. Hàng trống hoàn toàn bị bỏ qua. Nhãn lựa chọn
 * được lưu phẳng trên dòng đơn, nên MỖI nhãn chỉ được thuộc một nhóm (kể cả nhóm Đá có sẵn): trùng nhãn
 * giữa hai nhóm thì bấm nhóm này sẽ gỡ nhầm lựa chọn của nhóm kia.
 */
export function buildMenu(optionDrafts: readonly OptionGroupDraft[], toppingDrafts: readonly ToppingDraft[]): MenuResult {
  const optionGroups: OptionGroup[] = []
  const seenGroups = new Set([key(ICE_OPTION_GROUP.name)])
  const seenChoices = new Set(ICE_OPTION_GROUP.choices.map(key))

  for (const draft of optionDrafts) {
    const name = draft.name.trim()
    const choices = splitChoices(draft.choicesText)
    if (!name && choices.length === 0) continue
    if (!name) return { ok: false, error: 'Nhóm tuỳ chọn có lựa chọn nhưng chưa có tên nhóm.' }
    if (choices.length === 0) return { ok: false, error: `Nhóm “${name}” chưa có lựa chọn nào.` }
    if (seenGroups.has(key(name))) return { ok: false, error: `Tên nhóm “${name}” bị trùng.` }
    seenGroups.add(key(name))
    for (const choice of choices) {
      if (seenChoices.has(key(choice))) {
        return { ok: false, error: `Lựa chọn “${choice}” đã có ở nhóm khác — mỗi lựa chọn chỉ thuộc một nhóm.` }
      }
      seenChoices.add(key(choice))
    }
    optionGroups.push({ name, choices })
  }

  const toppingMenu: ToppingMenuItem[] = []
  const seenToppings = new Set<string>()
  for (const draft of toppingDrafts) {
    const name = draft.name.trim()
    if (!name && draft.price === null) continue
    if (!name) return { ok: false, error: 'Có topping chưa có tên.' }
    if (draft.price === null) return { ok: false, error: `Nhập giá cho topping “${name}” (0 nếu miễn phí).` }
    if (seenToppings.has(key(name))) return { ok: false, error: `Topping “${name}” bị trùng.` }
    seenToppings.add(key(name))
    toppingMenu.push({ name, price: draft.price })
  }

  return { ok: true, optionGroups, toppingMenu }
}

export const toOptionDrafts = (groups: readonly OptionGroup[]): OptionGroupDraft[] =>
  groups.map((group) => ({ name: group.name, choicesText: group.choices.join(', ') }))

export const toToppingDrafts = (menu: readonly ToppingMenuItem[]): ToppingDraft[] =>
  menu.map((item) => ({ name: item.name, price: item.price }))
