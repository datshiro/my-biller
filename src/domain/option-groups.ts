import type { Item, OptionGroupRow } from './schema'

type Topping = Extract<OptionGroupRow, { kind: 'topping' }>['toppings'][number]

/** Nối topping sang món khác (gộp món trùng); hai topping thành cùng một món thì giữ cái đứng trước. */
export function remapToppingItems(toppings: readonly Topping[], targetOf: (itemGid: string) => string): Topping[] {
  const seen = new Set<string>()
  return toppings
    .map((topping) => ({ ...topping, itemGid: targetOf(topping.itemGid) }))
    .filter((topping) => !seen.has(topping.itemGid) && seen.add(topping.itemGid))
}

/**
 * Nối phần tử topping `fromGid` sang `toGid` (món có sẵn cũng là món topping) hoặc gỡ hẳn (`toGid: null`). Schema không
 * cho nhóm rỗng nên nhóm hết topping thì giữ danh sách cũ và tắt nhóm; `maxSelect` hạ theo số phần tử còn lại. Không
 * đụng tới nhóm thì trả lại đúng đối tượng cũ.
 */
export function remapToppingGroup<T extends Record<string, unknown>>(group: T, fromGid: string, toGid: string | null): T {
  if (group.kind !== 'topping' || !Array.isArray(group.toppings)) return group
  const toppings = group.toppings as Topping[]
  if (!toppings.some((topping) => topping.itemGid === fromGid)) return group
  const next =
    toGid === null
      ? toppings.filter((topping) => topping.itemGid !== fromGid)
      : remapToppingItems(toppings, (gid) => (gid === fromGid ? toGid : gid))
  if (next.length === 0) return { ...group, isActive: 0 }
  const maxSelect = typeof group.maxSelect === 'number' ? Math.min(group.maxSelect, next.length) : group.maxSelect
  return { ...group, toppings: next, maxSelect }
}

export type ResolvedTopping = { item: Item; price: number }

export type ResolvedOptionGroup =
  | Extract<OptionGroupRow, { kind: 'choice' }>
  | (Omit<Extract<OptionGroupRow, { kind: 'topping' }>, 'toppings'> & { toppings: ResolvedTopping[] })

/**
 * Dựng các nhóm lựa chọn gắn vào một món/nhóm món. Hai luồng đồng bộ tới không cùng lúc và món có thể bị xoá sau
 * khi nhóm đã trỏ tới nó, nên gid nào không còn (hoặc nhóm đã tắt) thì ẩn đi chứ không nổ, và không tính giá.
 */
export function resolveOptionGroups(
  gids: readonly string[],
  groups: readonly OptionGroupRow[],
  items: readonly Item[],
): ResolvedOptionGroup[] {
  const groupByGid = new Map(groups.map((group) => [group.gid, group]))
  const itemByGid = new Map(items.map((item) => [item.gid, item]))
  return gids.flatMap((gid): ResolvedOptionGroup[] => {
    const group = groupByGid.get(gid)
    if (!group || group.isActive !== 1) return []
    if (group.kind === 'choice') return [group]
    const toppings = group.toppings.flatMap(({ itemGid, price }) => {
      const item = itemByGid.get(itemGid)
      return item && item.kind === 'topping' ? [{ item, price: price ?? item.unitPrice }] : []
    })
    return toppings.length > 0 ? [{ ...group, toppings }] : []
  })
}
