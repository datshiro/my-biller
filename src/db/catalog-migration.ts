import { db } from './db'
import { getRestoreBlock } from './backup'
import { migrateCatalogRows, type CatalogRows } from '@/domain/catalog-migration'

/**
 * Di trú menu cũ trên máy chưa ghép. Máy đã ghép, đang ghép hay đã bị thu hồi không bao giờ tự di trú: sổ chung có
 * đúng một người ghi là Worker, kết quả tới máy qua lượt kéo. Transaction thường, không qua outbox — máy chưa ghép
 * không có gì để đẩy, và khi ghép làm máy nạp sổ thì ảnh sổ đã mang sẵn kết quả.
 */
export async function migrateLocalCatalog(now = Date.now()): Promise<boolean> {
  return db.transaction('rw', [db.itemGroups, db.items, db.optionGroups, db.deviceState], async () => {
    if (await getRestoreBlock()) return false
    const [itemGroups, items, optionGroups] = await Promise.all([
      db.itemGroups.toCollection().raw().toArray(),
      db.items.toCollection().raw().toArray(),
      db.optionGroups.toArray(),
    ])
    const migrated = migrateCatalogRows({ itemGroups, items, optionGroups } as CatalogRows, now)
    if (!migrated) return false
    await Promise.all([
      db.items.bulkPut(migrated.changed.items),
      db.itemGroups.bulkPut(migrated.changed.itemGroups),
      db.optionGroups.bulkPut(migrated.changed.optionGroups),
    ])
    return true
  })
}
