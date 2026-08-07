import { useLiveQuery } from 'dexie-react-hooks'
import { getItem, listGroups, listItems } from '@/db/repositories/items'
import type { Item, ItemGroup } from '@/domain/schema'

/** `undefined` = đang đọc DB, `null` = không tìm thấy. Hai thứ này khác nhau nên màn hình hiện khác nhau. */
export function useItems(): Item[] | undefined {
  return useLiveQuery(() => listItems())
}

export function useItemGroups(): ItemGroup[] | undefined {
  return useLiveQuery(() => listGroups())
}

export function useItem(id: number | null): Item | null | undefined {
  return useLiveQuery(async () => (id === null ? null : ((await getItem(id)) ?? null)), [id])
}
