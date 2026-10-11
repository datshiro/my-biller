import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createItem, deleteItem } from '../repositories/items'
import {
  createOptionGroup,
  listOptionGroups,
  type OptionGroupInput,
  updateOptionGroup,
} from '../repositories/option-groups'
import { installTestDevice, testGid } from '@/test-fixtures'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

const itemInput = (name: string, over: { kind?: 'item' | 'topping'; isActive?: 0 | 1 } = {}) => ({
  name,
  groupId: null,
  unit: 'ly',
  unitPrice: 5_000,
  costPrice: null,
  isActive: over.isActive ?? (1 as const),
  ...(over.kind ? { kind: over.kind } : {}),
})

const choiceInput: OptionGroupInput = {
  kind: 'choice',
  name: 'Đường',
  required: 1,
  maxSelect: 1,
  defaultChoice: 'Ít đường',
  sortOrder: 1,
  isActive: 1,
  choices: ['Ít đường', 'Không đường'],
}

const toppingInput = (itemGid: string, over: Partial<OptionGroupInput> = {}): OptionGroupInput => ({
  kind: 'topping',
  name: 'Topping',
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder: 2,
  isActive: 1,
  toppings: [{ itemGid, price: null }],
  ...over,
} as OptionGroupInput)

describe('nhóm lựa chọn: ghi qua repository', () => {
  it('tạo nhóm chọn-một thì được cấp gid uuid và đọc lại đúng', async () => {
    const id = await createOptionGroup(choiceInput)

    const row = await db.optionGroups.get(id)
    expect(row).toMatchObject({ id, kind: 'choice', name: 'Đường', choices: ['Ít đường', 'Không đường'] })
    expect(row?.gid).toMatch(UUID)
    expect((await listOptionGroups()).map((group) => group.id)).toEqual([id])
  })

  it('nhóm topping chỉ nhận món đang là topping: món thường, gid không có đều bị từ chối và không ghi gì', async () => {
    const plainGid = (await db.items.get(await createItem(itemInput('Trà đá', { kind: 'item' }))))!.gid
    const toppingId = await createItem(itemInput('Trân châu', { kind: 'topping', isActive: 0 }))
    const toppingGid = (await db.items.get(toppingId))!.gid

    await expect(createOptionGroup(toppingInput(plainGid))).rejects.toThrow(/không phải món topping/)
    await expect(createOptionGroup(toppingInput(testGid(999)))).rejects.toThrow(/món topping đã bị xoá/)
    expect(await db.optionGroups.count()).toBe(0)

    const id = await createOptionGroup(toppingInput(toppingGid))
    expect(await db.optionGroups.get(id)).toMatchObject({ kind: 'topping', toppings: [{ itemGid: toppingGid, price: null }] })
  })

  it('sửa nhóm topping sang món không phải topping bị chặn, nhóm đang có giữ nguyên', async () => {
    const toppingGid = (await db.items.get(await createItem(itemInput('Trân châu', { kind: 'topping' }))))!.gid
    const plainGid = (await db.items.get(await createItem(itemInput('Trà đá', { kind: 'item' }))))!.gid
    const id = await createOptionGroup(toppingInput(toppingGid))
    const before = await db.optionGroups.get(id)

    await expect(updateOptionGroup(id, { toppings: [{ itemGid: plainGid, price: 2_000 }] } as Partial<OptionGroupInput>)).rejects.toThrow(
      /không phải món topping/,
    )
    expect(await db.optionGroups.get(id)).toEqual(before)
  })

  it('schema chặn trước khi ghi: topping rỗng và mặc định ngoài danh sách đều không vào sổ', async () => {
    await expect(createOptionGroup({ ...toppingInput(testGid(1)), toppings: [] } as OptionGroupInput)).rejects.toThrow()
    await expect(createOptionGroup({ ...choiceInput, defaultChoice: 'Đá' })).rejects.toThrow()
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('sửa nhóm không tồn tại báo lỗi rõ ràng', async () => {
    await expect(updateOptionGroup(12345, { name: 'Ma' })).rejects.toThrow(/Không tìm thấy nhóm lựa chọn/)
  })
})

describe('xoá món đang là topping', () => {
  it('xoá món đang nằm trong nhóm topping đang bật bị chặn, thông báo nêu tên nhóm', async () => {
    const toppingId = await createItem(itemInput('Trân châu', { kind: 'topping' }))
    const toppingGid = (await db.items.get(toppingId))!.gid
    await createOptionGroup(toppingInput(toppingGid, { name: 'Topping trà sữa' }))

    await expect(deleteItem(toppingId)).rejects.toThrow(/Topping trà sữa/)
    expect(await db.items.get(toppingId)).toMatchObject({ gid: toppingGid })
  })

  it('nhóm topping đã tắt thì không chặn xoá món', async () => {
    const toppingId = await createItem(itemInput('Trân châu', { kind: 'topping' }))
    const toppingGid = (await db.items.get(toppingId))!.gid
    const groupId = await createOptionGroup(toppingInput(toppingGid, { name: 'Topping trà sữa' }))
    await updateOptionGroup(groupId, { isActive: 0 })

    await deleteItem(toppingId)

    expect(await db.items.get(toppingId)).toBeUndefined()
  })
})
