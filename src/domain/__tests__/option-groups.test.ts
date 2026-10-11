import { describe, expect, it } from 'vitest'
import { remapToppingItems, resolveOptionGroups } from '../option-groups'
import type { Item, OptionGroupRow } from '../schema'
import { testGid } from '@/test-fixtures'

const item = (sequence: number, over: Partial<Item> = {}): Item => ({
  id: sequence,
  gid: testGid(sequence),
  name: `Món ${sequence}`,
  groupId: null,
  unit: 'ly',
  unitPrice: 5_000,
  costPrice: null,
  isActive: 1,
  note: '',
  kind: 'topping',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const choiceGroup = (sequence: number, over: { isActive?: 0 | 1 } = {}): OptionGroupRow => ({
  id: sequence,
  gid: testGid(sequence),
  kind: 'choice',
  name: 'Đường',
  required: 0,
  maxSelect: 1,
  defaultChoice: null,
  sortOrder: 1,
  isActive: over.isActive ?? 1,
  createdAt: 1,
  updatedAt: 1,
  choices: ['Ít đường', 'Không đường'],
})

const toppingGroup = (
  sequence: number,
  toppings: Array<{ itemSequence: number; price: number | null }>,
  over: { isActive?: 0 | 1 } = {},
): OptionGroupRow => ({
  id: sequence,
  gid: testGid(sequence),
  kind: 'topping',
  name: 'Topping',
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder: 2,
  isActive: over.isActive ?? 1,
  createdAt: 1,
  updatedAt: 1,
  toppings: toppings.map(({ itemSequence, price }) => ({ itemGid: testGid(itemSequence), price })),
})

describe('remapToppingItems', () => {
  it('đổi gid món theo hàm nhưng giữ giá và thứ tự', () => {
    const remapped = remapToppingItems(
      [
        { itemGid: testGid(1), price: null },
        { itemGid: testGid(2), price: 3_000 },
      ],
      (gid) => (gid === testGid(1) ? testGid(9) : gid),
    )
    expect(remapped).toEqual([
      { itemGid: testGid(9), price: null },
      { itemGid: testGid(2), price: 3_000 },
    ])
  })

  it('hai topping về cùng một món thì giữ cái đứng trước, bỏ cái sau', () => {
    const remapped = remapToppingItems(
      [
        { itemGid: testGid(1), price: 2_000 },
        { itemGid: testGid(2), price: null },
      ],
      () => testGid(2),
    )
    expect(remapped).toEqual([{ itemGid: testGid(2), price: 2_000 }])
  })

  it('không sửa mảng đầu vào', () => {
    const input = [{ itemGid: testGid(1), price: null }]
    remapToppingItems(input, () => testGid(7))
    expect(input).toEqual([{ itemGid: testGid(1), price: null }])
  })
})

describe('resolveOptionGroups', () => {
  it('nhóm chọn-một đang bật được trả nguyên; nhóm đã tắt và gid không còn thì ẩn', () => {
    const groups = [choiceGroup(1), choiceGroup(2, { isActive: 0 })]
    const resolved = resolveOptionGroups([testGid(2), testGid(1), testGid(99)], groups, [])
    expect(resolved).toEqual([groups[0]])
  })

  it('topping có price null lấy giá bán của món, topping có price riêng lấy giá đó', () => {
    const items = [item(1, { unitPrice: 5_000 }), item(2, { unitPrice: 4_000 })]
    const groups = [toppingGroup(10, [{ itemSequence: 1, price: null }, { itemSequence: 2, price: 3_000 }])]
    const [resolved] = resolveOptionGroups([testGid(10)], groups, items)
    expect(resolved?.kind === 'topping' && resolved.toppings.map((topping) => [topping.item.gid, topping.price])).toEqual([
      [testGid(1), 5_000],
      [testGid(2), 3_000],
    ])
  })

  it('topping trỏ món đã mất, món không phải topping, hoặc món thiếu kind (dữ liệu cũ) thì ẩn', () => {
    const items = [item(1), item(2, { kind: 'item' }), item(3, { kind: undefined })]
    const groups = [toppingGroup(10, [{ itemSequence: 1, price: null }, { itemSequence: 2, price: null }, { itemSequence: 3, price: null }, { itemSequence: 4, price: null }])]
    const [resolved] = resolveOptionGroups([testGid(10)], groups, items)
    expect(resolved?.kind === 'topping' && resolved.toppings.map((topping) => topping.item.gid)).toEqual([testGid(1)])
  })

  it('nhóm topping mà mọi món đều bị ẩn thì bỏ cả nhóm, không để nhóm rỗng hiện ra', () => {
    const groups = [toppingGroup(10, [{ itemSequence: 2, price: null }])]
    expect(resolveOptionGroups([testGid(10)], groups, [item(2, { kind: 'item' })])).toEqual([])
  })

  it('nhóm topping đã tắt thì ẩn cả các món bên trong', () => {
    const groups = [toppingGroup(10, [{ itemSequence: 1, price: null }], { isActive: 0 })]
    expect(resolveOptionGroups([testGid(10)], groups, [item(1)])).toEqual([])
  })

  it('giữ thứ tự gid mà món đã khai báo', () => {
    const groups = [choiceGroup(1), choiceGroup(2)]
    expect(resolveOptionGroups([testGid(2), testGid(1)], groups, []).map((group) => group.gid)).toEqual([
      testGid(2),
      testGid(1),
    ])
  })
})
