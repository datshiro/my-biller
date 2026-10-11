import { db } from '../db'
import { deleteByItem } from './customer-prices'
import { newGid } from '@/domain/gid'
import { ItemGroupSchema, ItemSchema, type Item, type ItemGroup } from '@/domain/schema'
import { syncTransaction } from '../sync/outbox'
import { activeGroupsUsingTopping } from './option-groups'

/** `note` để tuỳ chọn vì schema có `.default('')` — chỗ gọi không phải truyền chuỗi rỗng cho có. */
export type ItemInput = Omit<Item, 'id' | 'gid' | 'createdAt' | 'updatedAt' | 'note'> & { note?: string }
export type ItemGroupInput = Omit<ItemGroup, 'id' | 'gid' | 'createdAt' | 'updatedAt' | 'optionGroups' | 'toppingMenu'> &
  Partial<Pick<ItemGroup, 'optionGroups' | 'toppingMenu'>>

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

export async function createItem(input: ItemInput): Promise<number> {
  const stamp = now()
  return syncTransaction(() =>
    db.items.add(ItemSchema.parse({ ...input, gid: newGid(), createdAt: stamp, updatedAt: stamp })),
  )
}

/**
 * Hook đọc điền mặc định cho trường hàng gốc không có. Đẩy giá trị điền đó lên là ghi đè thứ máy khác vừa đặt, nên
 * trường đó chỉ được ghi khi đang sửa nó hoặc hàng gốc đã có nó.
 */
function keepUnknownFieldsAbsent(
  row: Record<string, unknown>,
  patch: object,
  stored: object | undefined,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (!(field in patch) && stored && !(field in stored)) delete row[field]
  }
}

/** Gộp lên hàng THÔ (không qua hook đọc): `kind`/`optionGroupGids` chỉ có khi hàng gốc có hoặc đang được sửa. */
export async function updateItem(id: number, patch: Partial<ItemInput>): Promise<void> {
  const stored = await db.items.where(':id').equals(id).raw().first()
  if (!stored) throw new Error(`Không tìm thấy mặt hàng #${id}`)
  await syncTransaction(() => db.items.put(ItemSchema.parse({ ...stored, ...patch, id, updatedAt: now() })))
}

/** Ngừng bán thay vì xoá: mặt hàng cũ vẫn cần cho phiếu đã xuất và báo cáo. */
export async function deactivateItem(id: number): Promise<number> {
  return syncTransaction(() => db.items.update(id, { isActive: 0 }))
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
  const item = await db.items.get(id)
  const usedBy = item ? await activeGroupsUsingTopping(item.gid) : []
  if (usedBy.length > 0) {
    throw new Error(`Món này đang là topping trong nhóm “${usedBy[0]!.name}” — gỡ khỏi nhóm trước khi xoá.`)
  }
  await syncTransaction(async () => {
    await deleteByItem(id)
    await db.items.delete(id)
  })
}

export function listGroups(): Promise<ItemGroup[]> {
  return db.itemGroups.orderBy('sortOrder').toArray()
}

export function getGroup(id: number): Promise<ItemGroup | undefined> {
  return db.itemGroups.get(id)
}

export async function createGroup(input: ItemGroupInput): Promise<number> {
  const stamp = now()
  return syncTransaction(() =>
    db.itemGroups.add(
      ItemGroupSchema.parse({ ...input, gid: newGid(), createdAt: stamp, updatedAt: stamp }),
    ),
  )
}

/** Nhóm mới xuống cuối. `sortOrder` không cần liên tục, chỉ cần tăng dần. */
export async function appendGroup(name: string): Promise<number> {
  const last = await db.itemGroups.orderBy('sortOrder').last()
  return createGroup({ name, sortOrder: (last?.sortOrder ?? 0) + 1 })
}

const MENU_FIELDS = ['optionGroups', 'toppingMenu'] as const
const GROUP_CATALOG_FIELDS = ['optionGroupGids'] as const

/**
 * Hàng nhóm ghi trước khi có thực đơn không có hai trường thực đơn, nhưng hook đọc của Dexie điền `[]` cho
 * chúng — và zod điền thêm một lần nữa lúc parse. Đẩy `[]` đó lên là nói "xoá hết thực đơn" thay cho "không
 * biết", và Worker (đúng) coi nó là xoá chủ ý nên xoá thực đơn trên mọi máy. Vì vậy chỉ ghi hai trường khi
 * người dùng đang sửa chúng hoặc hàng gốc thật sự có chúng; còn lại bỏ khoá để Worker giữ bản đã lưu.
 */
export async function updateGroup(id: number, patch: Partial<ItemGroupInput>): Promise<void> {
  const current = await db.itemGroups.get(id)
  if (!current) throw new Error(`Không tìm thấy nhóm #${id}`)
  const stored = await db.itemGroups.where(':id').equals(id).raw().first()
  await syncTransaction(() => {
    const row: Record<string, unknown> = ItemGroupSchema.parse({ ...current, ...patch, id, updatedAt: now() })
    keepUnknownFieldsAbsent(row, patch, stored, MENU_FIELDS)
    keepUnknownFieldsAbsent(row, patch, stored, GROUP_CATALOG_FIELDS)
    return db.itemGroups.put(row as ItemGroup)
  })
}

export function countItemsInGroup(id: number): Promise<number> {
  return db.items.where('groupId').equals(id).count()
}

/** Xoá nhóm chứ không xoá hàng: mặt hàng trong nhóm chỉ trở về "chưa phân nhóm". */
export async function deleteGroup(id: number): Promise<void> {
  await syncTransaction(async () => {
    await db.items.where('groupId').equals(id).modify({ groupId: null })
    await db.itemGroups.delete(id)
  })
}
