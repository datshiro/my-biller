import { useLiveQuery } from 'dexie-react-hooks'
import type { NameRow } from './name-list-screen'
import { countExpensesInCategory, listExpenseCategories } from '@/db/repositories/expenses'
import { countItemsInGroup, listGroups } from '@/db/repositories/items'

async function withUsage<T extends { id?: number; name: string }>(
  rows: T[],
  countUsage: (id: number) => Promise<number>,
): Promise<NameRow[]> {
  return Promise.all(
    rows.flatMap((row) => {
      const id = row.id
      return id === undefined ? [] : [countUsage(id).then((usage) => ({ id, name: row.name, usage }))]
    }),
  )
}

export function useItemGroupRows(): NameRow[] | undefined {
  return useLiveQuery(async () => withUsage(await listGroups(), countItemsInGroup))
}

export function useExpenseCategoryRows(): NameRow[] | undefined {
  return useLiveQuery(async () => withUsage(await listExpenseCategories(), countExpensesInCategory))
}
