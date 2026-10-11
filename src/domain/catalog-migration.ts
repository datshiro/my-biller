import { isEmptyCatalogMigrationPlan, planCatalogMigration } from '@shared/catalog-migration'
import type { BackupData, Item, ItemGroup, OptionGroupRow } from './schema'

type WithId<T> = T & { id: number }

export type CatalogRows = {
  itemGroups: WithId<ItemGroup>[]
  items: WithId<Item>[]
  optionGroups: WithId<OptionGroupRow>[]
}

const nextId = (rows: readonly { id: number }[]) => Math.max(0, ...rows.map((row) => row.id)) + 1

/**
 * Áp kế hoạch di trú lên hàng THÔ của máy cục bộ (chưa qua hook đọc: nhóm thiếu `optionGroupGids` phải còn thiếu).
 * `changed` chỉ gồm hàng tạo mới hoặc bị sửa — ghi lại hàng không đổi là hook `updating` đóng dấu `updatedAt` mới lên
 * cả sổ và làm lệch gộp file theo thời điểm sửa. `null` khi không có gì để di trú.
 */
export function migrateCatalogRows(rows: CatalogRows, now: number): { rows: CatalogRows; changed: CatalogRows } | null {
  const plan = planCatalogMigration({ groups: rows.itemGroups, items: rows.items, optionGroups: rows.optionGroups, now })
  if (isEmptyCatalogMigrationPlan(plan)) return null

  let itemId = nextId(rows.items)
  let optionGroupId = nextId(rows.optionGroups)
  const marked = new Set(plan.markToppings)
  const attach = new Map(plan.attach.map((entry) => [entry.groupGid, entry.optionGroupGids]))

  const changed: CatalogRows = {
    items: [
      ...rows.items.filter((item) => marked.has(item.gid)).map((item) => ({ ...item, kind: 'topping' as const, updatedAt: now })),
      ...plan.createItems.map((item) => ({ ...item, groupId: null, id: itemId++ })),
    ],
    itemGroups: rows.itemGroups.flatMap((group) => {
      const optionGroupGids = attach.get(group.gid)
      return optionGroupGids ? [{ ...group, optionGroupGids, updatedAt: now }] : []
    }),
    optionGroups: plan.createOptionGroups.map((group) => ({ ...group, id: optionGroupId++ })),
  }

  const replace = <T extends { id: number }>(current: T[], updates: T[]) => {
    const byId = new Map(updates.map((row) => [row.id, row]))
    const known = new Set(current.map((row) => row.id))
    return [...current.map((row) => byId.get(row.id) ?? row), ...updates.filter((row) => !known.has(row.id))]
  }
  return {
    rows: {
      items: replace(rows.items, changed.items),
      itemGroups: replace(rows.itemGroups, changed.itemGroups),
      optionGroups: replace(rows.optionGroups, changed.optionGroups),
    },
    changed,
  }
}

/** Sổ nạp từ file sao lưu (v1–v4 chưa có mô hình mới) đã di trú, để bản kỳ vọng của báo cáo sau khôi phục khớp sổ ghi. */
export function migrateBackupData(data: BackupData, now: number): BackupData {
  const migrated = migrateCatalogRows(data, now)
  return migrated ? { ...data, ...migrated.rows } : data
}
