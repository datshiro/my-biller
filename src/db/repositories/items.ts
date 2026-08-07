import { db } from '../db'
import { ItemGroupSchema, ItemSchema, type Item, type ItemGroup } from '@/domain/schema'

/** `note` để tuỳ chọn vì schema có `.default('')` — chỗ gọi không phải truyền chuỗi rỗng cho có. */
export type ItemInput = Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'note'> & { note?: string }
export type ItemGroupInput = Omit<ItemGroup, 'id' | 'createdAt' | 'updatedAt'>

const now = () => Date.now()

export function listItems(): Promise<Item[]> {
  return db.items.orderBy('name').toArray()
}

export function listActiveItems(): Promise<Item[]> {
  return db.items.where('isActive').equals(1).sortBy('name')
}

export function getItem(id: number): Promise<Item | undefined> {
  return db.items.get(id)
}

export function createItem(input: ItemInput): Promise<number> {
  const stamp = now()
  return db.items.add(ItemSchema.parse({ ...input, createdAt: stamp, updatedAt: stamp }))
}

export async function updateItem(id: number, patch: Partial<ItemInput>): Promise<void> {
  const current = await db.items.get(id)
  if (!current) throw new Error(`Không tìm thấy mặt hàng #${id}`)
  await db.items.put(ItemSchema.parse({ ...current, ...patch, id, updatedAt: now() }))
}

/** Ngừng bán thay vì xoá: mặt hàng cũ vẫn cần cho phiếu đã xuất và báo cáo. */
export function deactivateItem(id: number): Promise<number> {
  return db.items.update(id, { isActive: 0 })
}

export function countOrderLinesOfItem(itemId: number): Promise<number> {
  return db.orderLines.where('itemId').equals(itemId).count()
}

/** Chỉ dùng cho mặt hàng chưa từng bán; đã bán rồi thì `deactivateItem`. */
export async function deleteItem(id: number): Promise<void> {
  const sold = await countOrderLinesOfItem(id)
  if (sold > 0) {
    throw new Error(`Mặt hàng này đã bán ${sold} lần — hãy chọn "Ngừng bán" thay vì xoá.`)
  }
  await db.items.delete(id)
}

export function listGroups(): Promise<ItemGroup[]> {
  return db.itemGroups.orderBy('sortOrder').toArray()
}

export function createGroup(input: ItemGroupInput): Promise<number> {
  const stamp = now()
  return db.itemGroups.add(ItemGroupSchema.parse({ ...input, createdAt: stamp, updatedAt: stamp }))
}

/** Nhóm mới xuống cuối. `sortOrder` không cần liên tục, chỉ cần tăng dần. */
export async function appendGroup(name: string): Promise<number> {
  const last = await db.itemGroups.orderBy('sortOrder').last()
  return createGroup({ name, sortOrder: (last?.sortOrder ?? 0) + 1 })
}

export async function updateGroup(id: number, patch: Partial<ItemGroupInput>): Promise<void> {
  const current = await db.itemGroups.get(id)
  if (!current) throw new Error(`Không tìm thấy nhóm #${id}`)
  await db.itemGroups.put(ItemGroupSchema.parse({ ...current, ...patch, id, updatedAt: now() }))
}

export function countItemsInGroup(id: number): Promise<number> {
  return db.items.where('groupId').equals(id).count()
}

/** Xoá nhóm chứ không xoá hàng: mặt hàng trong nhóm chỉ trở về "chưa phân nhóm". */
export async function deleteGroup(id: number): Promise<void> {
  await db.transaction('rw', db.itemGroups, db.items, async () => {
    await db.items.where('groupId').equals(id).modify({ groupId: null })
    await db.itemGroups.delete(id)
  })
}
