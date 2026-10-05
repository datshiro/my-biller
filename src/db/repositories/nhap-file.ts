import { db } from '../db'
import { syncTransaction } from '../sync/outbox'
import { getDeviceConnection } from './device-state'
import { newGid } from '@/domain/gid'
import { itemNameKey } from '@shared/item-name'
import {
  effectiveCustomerWrites,
  effectiveItemWrites,
  planCustomerImport,
  planItemImport,
  type CustomerRow,
  type DuplicatePolicy,
  type GroupTarget,
  type ItemRow,
} from '@/domain/nhap-file'
import { CustomerSchema, ItemGroupSchema, ItemSchema } from '@/domain/schema'

export type ImportResult = {
  created: number
  updated: number
  skipped: number
  unchanged: number
  groupsCreated: number
  queued: boolean
  duplicatesInactive: number
}

/** "Sổ vừa đổi trong lúc xem trước": kế hoạch xem trước không còn khớp dữ liệu hiện có, giao dịch huỷ. */
export class ImportChangedError extends Error {
  override name = 'ImportChangedError'
}

export async function applyItemImport(rows: ItemRow[], policy: DuplicatePolicy): Promise<ImportResult> {
  return syncTransaction(async () => {
    const [items, groups] = await Promise.all([db.items.toArray(), db.itemGroups.toArray()])
    const plan = planItemImport(rows, items, groups)
    if (plan.errors.length > 0) {
      throw new ImportChangedError('Sổ vừa đổi trong lúc xem trước. Chọn lại file để xem trước lại.')
    }
    const writes = effectiveItemWrites(plan, policy)
    const stamp = Date.now()

    // Soát hợp lệ (ItemSchema.parse) cho TOÀN BỘ dòng trước khi ghi byte đầu tiên: một dòng hỏng ở giữa
    // (vd `unitPrice` âm) không được để lại nhóm/món của các dòng trước nó đã ghi dở trong cùng giao dịch.
    // `groupId` chưa biết id thật (chưa ghi nhóm) nên validate tạm bằng `null` — ItemSchema chỉ cần đúng
    // kiểu (số nguyên dương hoặc null), id thật được thay vào ngay trước khi ghi ở vòng dưới.
    for (const entry of writes.creates) {
      ItemSchema.parse({
        name: entry.row.name,
        groupId: null,
        unit: entry.row.unit,
        unitPrice: entry.row.unitPrice,
        costPrice: entry.row.costPrice,
        isActive: 1,
        note: entry.row.note,
        gid: newGid(),
        createdAt: stamp,
        updatedAt: stamp,
      })
    }
    for (const entry of writes.updates) {
      ItemSchema.parse({ ...entry.existing, ...entry.changes, groupId: null, id: entry.existing.id, updatedAt: stamp })
    }

    // Mọi dòng đã soát hợp lệ — giờ mới ghi. Nhóm mới tạo TUẦN TỰ (không Promise.all) trước khi tạo/sửa
    // món: outbox event của nhóm phải có `id` nhỏ hơn mọi sự kiện món trỏ tới nó (refsFor đọc gid nhóm
    // qua bảng itemGroups khi món được capture).
    const lastGroup = await db.itemGroups.orderBy('sortOrder').last()
    let nextSortOrder = (lastGroup?.sortOrder ?? 0) + 1
    const groupIdByKey = new Map<string, number>()
    for (const name of writes.groupsToCreate) {
      const id = await db.itemGroups.add(
        ItemGroupSchema.parse({ name, sortOrder: nextSortOrder, gid: newGid(), createdAt: stamp, updatedAt: stamp }),
      )
      groupIdByKey.set(itemNameKey(name), id)
      nextSortOrder += 1
    }

    const resolveGroupId = (group: GroupTarget, keepGroupId: number | null): number | null => {
      if (group === null) return keepGroupId
      if ('existingId' in group) return group.existingId
      return groupIdByKey.get(itemNameKey(group.newName)) ?? null
    }

    for (const entry of writes.creates) {
      await db.items.add(
        ItemSchema.parse({
          name: entry.row.name,
          groupId: resolveGroupId(entry.group, null),
          unit: entry.row.unit,
          unitPrice: entry.row.unitPrice,
          costPrice: entry.row.costPrice,
          isActive: 1,
          note: entry.row.note,
          gid: newGid(),
          createdAt: stamp,
          updatedAt: stamp,
        }),
      )
    }
    for (const entry of writes.updates) {
      await db.items.put(
        ItemSchema.parse({
          ...entry.existing,
          ...entry.changes,
          groupId: resolveGroupId(entry.group, entry.existing.groupId),
          id: entry.existing.id,
          updatedAt: stamp,
        }),
      )
    }

    const duplicatesInactive = plan.duplicates.filter((entry) => entry.existing.isActive === 0).length
    const connection = await getDeviceConnection()
    return {
      created: writes.creates.length,
      updated: writes.updates.length,
      skipped: writes.skipped,
      unchanged: writes.unchanged,
      groupsCreated: writes.groupsToCreate.length,
      queued: connection !== undefined,
      duplicatesInactive,
    }
  })
}

export async function applyCustomerImport(rows: CustomerRow[], policy: DuplicatePolicy): Promise<ImportResult> {
  return syncTransaction(async () => {
    const customers = await db.customers.toArray()
    const plan = planCustomerImport(rows, customers)
    if (plan.errors.length > 0) {
      throw new ImportChangedError('Sổ vừa đổi trong lúc xem trước. Chọn lại file để xem trước lại.')
    }
    const writes = effectiveCustomerWrites(plan, policy)
    const stamp = Date.now()

    for (const row of writes.creates) {
      await db.customers.add(
        CustomerSchema.parse({
          name: row.name,
          phone: row.phone,
          address: row.address,
          note: row.note,
          gid: newGid(),
          createdAt: stamp,
          updatedAt: stamp,
        }),
      )
    }
    for (const entry of writes.updates) {
      await db.customers.put(
        CustomerSchema.parse({ ...entry.existing, ...entry.changes, id: entry.existing.id, updatedAt: stamp }),
      )
    }

    const connection = await getDeviceConnection()
    return {
      created: writes.creates.length,
      updated: writes.updates.length,
      skipped: writes.skipped,
      unchanged: writes.unchanged,
      groupsCreated: 0,
      queued: connection !== undefined,
      duplicatesInactive: 0,
    }
  })
}
