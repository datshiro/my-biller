import { catalogNameKey } from '@shared/catalog-migration'
import { ICE_OPTION_GROUP } from './line-extras'
import type { Item, ItemGroup, OptionGroupRow } from './schema'

type ChoiceDraft = { name: string; kind: 'choice'; choices: string[]; maxSelect: number | null; defaultChoice: string | null }

/** Mẫu có sẵn ở form nhóm lựa chọn. Nhãn không trùng nhau giữa ba mẫu và với hằng Đá, nên gắn cùng một món được. */
export const OPTION_GROUP_TEMPLATES: readonly ChoiceDraft[] = [
  {
    name: 'Đường',
    kind: 'choice',
    choices: ['0% đường', '30% đường', '50% đường', '70% đường', '100% đường'],
    maxSelect: 1,
    defaultChoice: '100% đường',
  },
  {
    name: 'Mức đá',
    kind: 'choice',
    choices: ['Không đá', 'Ít đá', 'Đá thường', 'Thêm đá'],
    maxSelect: 1,
    defaultChoice: 'Đá thường',
  },
  {
    name: 'Ghi chú nhanh',
    kind: 'choice',
    choices: ['Không hành', 'Ít hành', 'Không cay', 'Thêm cay', 'Ít ngọt'],
    maxSelect: 5,
    defaultChoice: null,
  },
]

type CatalogItem = Pick<Item, 'gid' | 'name' | 'kind'>

/** Chủ của nhãn hằng Đá — không dùng tên "Đá", vì chủ quán có thể tự đặt một nhóm tên Đá. */
const ICE = Symbol('ice')

/**
 * Dòng đơn chỉ lưu nhãn phẳng (`options`) và topping theo tên, nên hai nhóm cùng gắn một món mà trùng nhãn thì chọn
 * ở nhóm này làm chip nhóm kia sáng theo, và nhóm bắt buộc bị tính là đã chọn nhờ nhãn nhóm kia. Trả câu báo cho
 * nhãn trùng đầu tiên (kể cả với hằng Đá có sẵn cho mọi món), hoặc `null`.
 */
export function labelClash(groups: readonly OptionGroupRow[], items: readonly CatalogItem[]): string | null {
  const itemByGid = new Map(items.map((item) => [item.gid, item]))
  const choiceOwner = new Map<string, string | typeof ICE>(ICE_OPTION_GROUP.choices.map((choice) => [choice, ICE]))
  const toppingOwner = new Map<string, OptionGroupRow>()
  for (const group of groups) {
    if (group.isActive !== 1) continue
    if (group.kind === 'choice') {
      for (const choice of group.choices) {
        const owner = choiceOwner.get(choice.trim())
        if (owner !== undefined) {
          return owner === ICE
            ? `Lựa chọn “${choice}” đã có ở nhóm Đá có sẵn cho mọi món — mỗi lựa chọn chỉ thuộc một nhóm.`
            : `Lựa chọn “${choice}” có ở cả nhóm “${owner}” và “${group.name}” — mỗi lựa chọn chỉ thuộc một nhóm.`
        }
        choiceOwner.set(choice.trim(), group.name)
      }
      continue
    }
    for (const topping of group.toppings) {
      const item = itemByGid.get(topping.itemGid)
      if (!item) continue
      const key = catalogNameKey(item.name)
      const owner = toppingOwner.get(key)
      if (owner !== undefined && owner.gid !== group.gid) {
        return `Topping “${item.name.trim()}” có ở cả nhóm “${owner.name}” và “${group.name}”.`
      }
      toppingOwner.set(key, group)
    }
  }
  return null
}

const pick = (gids: readonly string[], byGid: ReadonlyMap<string, OptionGroupRow>) =>
  gids.flatMap((gid) => {
    const row = byGid.get(gid)
    return row ? [row] : []
  })

/** Mọi nhóm một món nhận trên màn bán: nhóm gắn thẳng vào món và nhóm gắn vào nhóm món của nó. */
function groupsOfItem(
  item: Pick<Item, 'optionGroupGids'>,
  itemGroup: Pick<ItemGroup, 'optionGroupGids'> | undefined,
  byGid: ReadonlyMap<string, OptionGroupRow>,
): OptionGroupRow[] {
  const own = item.optionGroupGids ?? []
  return pick([...own, ...(itemGroup?.optionGroupGids ?? []).filter((gid) => !own.includes(gid))], byGid)
}

export type Catalog = {
  optionGroups: readonly OptionGroupRow[]
  items: readonly (CatalogItem & Pick<Item, 'id' | 'groupId' | 'optionGroupGids'>)[]
  itemGroups: readonly Pick<ItemGroup, 'id' | 'name' | 'optionGroupGids'>[]
}

/** Mọi chỗ trùng nhãn trên danh mục, kèm tên món hoặc nhóm món để chủ quán biết gỡ ở đâu. */
function catalogClashes(catalog: Catalog): string[] {
  const byGid = new Map(catalog.optionGroups.map((row) => [row.gid, row]))
  const itemGroupById = new Map(catalog.itemGroups.map((group) => [group.id, group]))
  return [
    ...catalog.itemGroups.flatMap((group) => {
      const clash = labelClash(pick(group.optionGroupGids ?? [], byGid), catalog.items)
      return clash ? [`Nhóm món “${group.name}”: ${clash}`] : []
    }),
    ...catalog.items.flatMap((item) => {
      const clash = labelClash(groupsOfItem(item, itemGroupById.get(item.groupId ?? -1), byGid), catalog.items)
      return clash ? [`Món “${item.name}”: ${clash}`] : []
    }),
  ]
}

/**
 * Chỗ trùng nhãn mà chính thay đổi này gây ra (so danh mục trước và sau khi áp). Chỗ trùng có sẵn — máy 2.19.0 sửa
 * menu cũ, hai máy cùng gắn — không được chặn việc sửa một món hay nhóm không liên quan.
 */
export function catalogClash(before: Catalog, after: Catalog): string | null {
  const existing = new Set(catalogClashes(before))
  return catalogClashes(after).find((clash) => !existing.has(clash)) ?? null
}

/** Nơi đang gắn một nhóm lựa chọn — lưu trữ nhóm đang được dùng thì chặn và liệt kê chỗ này. */
export function placesUsing(gid: string, catalog: Pick<Catalog, 'items' | 'itemGroups'>): string[] {
  return [
    ...catalog.itemGroups.filter((group) => group.optionGroupGids?.includes(gid)).map((group) => `nhóm món “${group.name}”`),
    ...catalog.items.filter((item) => item.optionGroupGids?.includes(gid)).map((item) => `món “${item.name}”`),
  ]
}

/** Tách ô "các lựa chọn, cách nhau bằng dấu phẩy" thành danh sách, bỏ ô trống và mục trùng. */
export function parseChoices(text: string): string[] {
  return [...new Set(text.split(',').map((choice) => choice.trim()).filter(Boolean))]
}
