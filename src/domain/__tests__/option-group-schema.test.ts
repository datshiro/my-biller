import { describe, expect, it } from 'vitest'
import { LedgerTableSchema, OptionGroupPayloadSchema } from '@shared/ledger-schemas'
import { ItemGroupSchema, ItemSchema, OptionGroupRowSchema } from '../schema'
import { testGid } from '@/test-fixtures'

const choiceGroup = (over: Record<string, unknown> = {}) => ({
  gid: testGid(31),
  name: 'Đường',
  required: 1,
  maxSelect: 1,
  defaultChoice: 'Ít đường',
  sortOrder: 1,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
  kind: 'choice',
  choices: ['Ít đường', 'Không đường'],
  ...over,
})

const toppingGroup = (over: Record<string, unknown> = {}) => ({
  gid: testGid(32),
  name: 'Topping',
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder: 2,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
  kind: 'topping',
  toppings: [{ itemGid: testGid(41), price: null }],
  ...over,
})

const itemRow = (over: Record<string, unknown> = {}) => ({
  gid: testGid(51),
  name: 'Phở',
  groupId: null,
  unit: 'tô',
  unitPrice: 50_000,
  costPrice: null,
  isActive: 1,
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const gidsOf = (count: number) => Array.from({ length: count }, (_, index) => testGid(200 + index))

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : result.error!.issues.map((issue) => issue.path.map(String).join('.'))

describe('nhóm lựa chọn: hình dạng theo kind', () => {
  it('nhóm chọn-một và nhóm topping đều qua, kind quyết định hình dạng còn lại', () => {
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup()).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(toppingGroup()).success).toBe(true)
  })

  it('kind lạ bị từ chối', () => {
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ kind: 'combo' })).success).toBe(false)
  })

  it('kind topping thiếu danh sách món, hoặc kind choice thiếu danh sách lựa chọn, bị từ chối', () => {
    expect(OptionGroupPayloadSchema.safeParse({ ...choiceGroup(), kind: 'topping' }).success).toBe(false)
    expect(OptionGroupPayloadSchema.safeParse({ ...toppingGroup(), kind: 'choice' }).success).toBe(false)
  })

  it('OptionGroupRowSchema giữ id của hàng đã lưu, payload đi đường đồng bộ thì không mang id', () => {
    expect(OptionGroupRowSchema.parse({ ...choiceGroup(), id: 3 })).toMatchObject({ id: 3, kind: 'choice' })
    expect(OptionGroupPayloadSchema.parse({ ...choiceGroup(), id: 3 })).not.toHaveProperty('id')
  })
})

describe('nhóm lựa chọn: giới hạn độ dài', () => {
  it('30 lựa chọn qua, 31 bị từ chối', () => {
    const choices = (count: number) => Array.from({ length: count }, (_, index) => `Lựa chọn ${index}`)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: choices(30), defaultChoice: null })).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: choices(31), defaultChoice: null })).success).toBe(false)
  })

  it('nhãn 40 ký tự qua, 41 ký tự bị từ chối', () => {
    const label = (length: number) => 'a'.repeat(length)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: [label(40)], defaultChoice: null })).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: [label(41)], defaultChoice: null })).success).toBe(false)
  })

  it('lựa chọn trùng nhau hoặc chỉ toàn khoảng trắng bị từ chối', () => {
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: ['Đá', 'Đá'], defaultChoice: null })).success).toBe(false)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: ['   '], defaultChoice: null })).success).toBe(false)
  })

  it('danh sách lựa chọn rỗng bị từ chối ngay ở danh sách, không nhờ maxSelect', () => {
    const result = OptionGroupPayloadSchema.safeParse(choiceGroup({ choices: [], maxSelect: null, defaultChoice: null }))
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toEqual(['choices'])
  })

  it('31 món topping bị từ chối, cùng một món hai lần bị từ chối, giá âm bị từ chối, giá null qua', () => {
    const toppings = (count: number) => gidsOf(count).map((itemGid) => ({ itemGid, price: null }))
    expect(OptionGroupPayloadSchema.safeParse(toppingGroup({ toppings: toppings(30) })).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(toppingGroup({ toppings: toppings(31) })).success).toBe(false)
    expect(
      OptionGroupPayloadSchema.safeParse(
        toppingGroup({ toppings: [{ itemGid: testGid(41), price: null }, { itemGid: testGid(41), price: 1_000 }] }),
      ).success,
    ).toBe(false)
    expect(
      OptionGroupPayloadSchema.safeParse(toppingGroup({ toppings: [{ itemGid: testGid(41), price: -1 }] })).success,
    ).toBe(false)
  })
})

describe('nhóm lựa chọn: ràng buộc chéo (superRefine)', () => {
  it('maxSelect vượt số lựa chọn bị chặn đúng ở trường maxSelect', () => {
    const result = OptionGroupPayloadSchema.safeParse(choiceGroup({ maxSelect: 3 }))
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain('maxSelect')
  })

  it('maxSelect bằng đúng số lựa chọn qua; chọn-nhiều (ghi chú nhanh) hợp lệ; maxSelect 0 bị chặn', () => {
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ maxSelect: 2 })).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ maxSelect: null, defaultChoice: null })).success).toBe(true)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ maxSelect: 0 })).success).toBe(false)
  })

  it('maxSelect của nhóm topping cũng không được vượt số món', () => {
    expect(OptionGroupPayloadSchema.safeParse(toppingGroup({ maxSelect: 2 })).success).toBe(false)
  })

  it('lựa chọn mặc định phải nằm trong danh sách, và chỉ nhóm chọn mới có mặc định', () => {
    const outside = OptionGroupPayloadSchema.safeParse(choiceGroup({ defaultChoice: 'Đá' }))
    expect(outside.success).toBe(false)
    expect(issuePaths(outside)).toContain('defaultChoice')
    expect(OptionGroupPayloadSchema.safeParse(toppingGroup({ defaultChoice: 'Trân châu' })).success).toBe(false)
    expect(OptionGroupPayloadSchema.safeParse(choiceGroup({ defaultChoice: null })).success).toBe(true)
  })
})

describe('món và nhóm món: trường danh mục là tuỳ chọn, không có mặc định ở schema', () => {
  it('hàng món thiếu kind đọc ra KHÔNG có kind và optionGroupGids', () => {
    const parsed = ItemSchema.parse(itemRow())
    expect(parsed).not.toHaveProperty('kind')
    expect(parsed).not.toHaveProperty('optionGroupGids')
  })

  it('kind chỉ nhận item hoặc topping; giá trị lạ bị từ chối', () => {
    expect(ItemSchema.parse(itemRow({ kind: 'topping' })).kind).toBe('topping')
    expect(ItemSchema.safeParse(itemRow({ kind: 'bogus' })).success).toBe(false)
  })

  it('optionGroupGids tối đa 20, không trùng, và phải là uuid', () => {
    expect(ItemSchema.safeParse(itemRow({ optionGroupGids: gidsOf(20) })).success).toBe(true)
    expect(ItemSchema.safeParse(itemRow({ optionGroupGids: gidsOf(21) })).success).toBe(false)
    expect(ItemSchema.safeParse(itemRow({ optionGroupGids: [testGid(1), testGid(1)] })).success).toBe(false)
    expect(ItemSchema.safeParse(itemRow({ optionGroupGids: ['không-phải-uuid'] })).success).toBe(false)
  })

  it('nhóm món: optionGroupGids cũng ràng buộc như món, thiếu thì không thêm khoá', () => {
    const group = { gid: testGid(61), name: 'Nước', sortOrder: 1, createdAt: 1, updatedAt: 1 }
    expect(ItemGroupSchema.parse(group)).not.toHaveProperty('optionGroupGids')
    expect(ItemGroupSchema.parse({ ...group, optionGroupGids: gidsOf(20) }).optionGroupGids).toHaveLength(20)
    expect(ItemGroupSchema.safeParse({ ...group, optionGroupGids: gidsOf(21) }).success).toBe(false)
  })
})

describe('bảng nhóm lựa chọn không nằm trong sổ chính', () => {
  it('LedgerTableSchema không nhận optionGroups, để máy bản cũ không kẹt khi gặp bảng lạ', () => {
    expect(LedgerTableSchema.safeParse('optionGroups').success).toBe(false)
    expect(LedgerTableSchema.safeParse('items').success).toBe(true)
  })
})
