import { db } from '../db'
import { syncTransaction } from '../sync/outbox'
import { newGid } from '@/domain/gid'
import { OptionGroupRowSchema, type OptionGroupRow } from '@/domain/schema'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type OptionGroupInput = DistributiveOmit<OptionGroupRow, 'id' | 'gid' | 'createdAt' | 'updatedAt'>

const now = () => Date.now()

export function listOptionGroups(): Promise<OptionGroupRow[]> {
  return db.optionGroups.orderBy('sortOrder').toArray()
}

/** Topping phải trỏ tới món có thật và đã là món topping; không thì nhóm bán kèm một thứ không ai sửa giá được. */
async function toppingProblem(row: OptionGroupRow): Promise<string | null> {
  if (row.kind !== 'topping') return null
  const items = await db.items.where('gid').anyOf(row.toppings.map((topping) => topping.itemGid)).toArray()
  const byGid = new Map(items.map((item) => [item.gid, item]))
  const missing = row.toppings.find((topping) => byGid.get(topping.itemGid)?.kind !== 'topping')
  if (!missing) return null
  // Nhóm đang tắt vẫn có thể giữ món đã bị xoá; bật/sửa lại nhóm đó phải nói rõ là món đã xoá, không phải "sai loại".
  return byGid.has(missing.itemGid)
    ? `Nhóm “${row.name}” trỏ tới một món không phải món topping.`
    : `Nhóm “${row.name}” còn một món topping đã bị xoá; gỡ món đó khỏi nhóm rồi lưu lại.`
}

async function writeOptionGroup(row: OptionGroupRow): Promise<number> {
  return syncTransaction(async () => {
    const problem = await toppingProblem(row)
    if (problem) throw new Error(problem)
    return db.optionGroups.put(row)
  })
}

export async function createOptionGroup(input: OptionGroupInput): Promise<number> {
  const stamp = now()
  return writeOptionGroup(OptionGroupRowSchema.parse({ ...input, gid: newGid(), createdAt: stamp, updatedAt: stamp }))
}

export async function updateOptionGroup(id: number, patch: Partial<OptionGroupInput>): Promise<void> {
  const current = await db.optionGroups.get(id)
  if (!current) throw new Error(`Không tìm thấy nhóm lựa chọn #${id}`)
  await writeOptionGroup(OptionGroupRowSchema.parse({ ...current, ...patch, id, updatedAt: now() }))
}

/** Nhóm topping đang bật có chứa món này; xoá món khi còn nhóm dùng là để lại một phần tử trỏ vào chỗ trống. */
export async function activeGroupsUsingTopping(itemGid: string): Promise<OptionGroupRow[]> {
  const groups = await db.optionGroups.where('isActive').equals(1).toArray()
  return groups.filter(
    (group) => group.kind === 'topping' && group.toppings.some((topping) => topping.itemGid === itemGid),
  )
}
