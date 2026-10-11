import { describe, expect, it } from 'vitest'
import { projectLegacyMenu } from '@shared/legacy-menu'
import {
  attachedOptionGroups,
  defaultOptions,
  hasNotePhrase,
  hasOptions,
  isGroupMissing,
  optionGroupsFor,
  selectedCount,
  type SaleOptionGroup,
  orphanOptions,
  recentNotePhrases,
  setToppingQty,
  toggleNotePhrase,
  toggleOption,
  toppingAmount,
  toppingLabel,
} from '../line-extras'
import type { OptionGroupRow } from '../schema'

const duong = {
  gid: 'g-duong',
  name: 'Đường',
  kind: 'choice',
  choices: ['Ít đường', 'Không đường', 'Nhiều đường'],
  required: false,
  maxSelect: 1,
  defaultChoice: null,
} satisfies SaleOptionGroup
const ICE = { choices: ['Đá chung', 'Đá riêng'] }

const T = 1_700_000_000_000
const choiceRow = (gid: string, name: string, choices: string[], extra: Partial<OptionGroupRow> = {}): OptionGroupRow =>
  ({
    gid,
    name,
    kind: 'choice',
    choices,
    required: 0,
    maxSelect: 1,
    defaultChoice: null,
    sortOrder: 0,
    isActive: 1,
    createdAt: T,
    updatedAt: T,
    ...extra,
  }) as OptionGroupRow
const toppingRow = (
  gid: string,
  name: string,
  toppings: { itemGid: string; price: number | null }[],
  extra: Partial<OptionGroupRow> = {},
): OptionGroupRow =>
  ({
    gid,
    name,
    kind: 'topping',
    toppings,
    required: 0,
    maxSelect: null,
    defaultChoice: null,
    sortOrder: 0,
    isActive: 1,
    createdAt: T,
    updatedAt: T,
    ...extra,
  }) as OptionGroupRow
const toppingItem = (gid: string, name: string, unitPrice: number) => ({ gid, name, unitPrice, isActive: 0, kind: 'topping' as const })

describe('optionGroupsFor', () => {
  const items = [toppingItem('i-tc', 'Trân châu', 5_000), toppingItem('i-th', 'Thạch', 3_000)]

  it('nhóm Đá luôn đứng đầu và có cho cả món chưa phân nhóm, nhóm món không gắn gì', () => {
    const empty = { optionGroups: [], items: [] }
    expect(optionGroupsFor(undefined, undefined, empty).map((g) => g.name)).toEqual(['Đá'])
    expect(optionGroupsFor({ optionGroupGids: [] }, { optionGroupGids: [] }, empty).map((g) => g.name)).toEqual(['Đá'])
    expect(hasOptions(optionGroupsFor(undefined, { optionGroupGids: [] }, empty))).toBe(false)
  })

  it('nhóm của món đứng trước nhóm của nhóm món, mỗi khối theo sortOrder; bỏ gid trùng, nhóm tắt và nhóm đã mất', () => {
    const optionGroups = [
      choiceRow('a', 'Size', ['M', 'L'], { sortOrder: 5 }),
      choiceRow('b', 'Đường', ['50%', '100%'], { sortOrder: 1 }),
      choiceRow('c', 'Mức đá', ['Ít', 'Thường'], { sortOrder: 0 }),
      choiceRow('d', 'Đã tắt', ['x'], { sortOrder: 0, isActive: 0 }),
    ]
    const groups = optionGroupsFor(
      { optionGroupGids: ['a', 'mat'] },
      { optionGroupGids: ['b', 'a', 'd', 'c'] },
      { optionGroups, items },
    )
    expect(groups.map((g) => g.name)).toEqual(['Đá', 'Size', 'Mức đá', 'Đường'])
  })

  it('topping lấy tên và giá của món topping, giá riêng của nhóm thắng; trỏ món mất hay không phải topping thì bỏ', () => {
    const optionGroups = [
      toppingRow('t', 'Topping', [
        { itemGid: 'i-tc', price: null },
        { itemGid: 'i-th', price: 4_000 },
        { itemGid: 'i-mat', price: null },
        { itemGid: 'i-mon', price: null },
      ]),
      toppingRow('rong', 'Rỗng', [{ itemGid: 'i-mat', price: null }]),
    ]
    const all = [...items, { gid: 'i-mon', name: 'Phở', unitPrice: 50_000, isActive: 1, kind: 'item' as const }]
    const groups = attachedOptionGroups(undefined, { optionGroupGids: ['t', 'rong'] }, { optionGroups, items: all })
    expect(groups).toEqual([
      {
        gid: 't',
        name: 'Topping',
        kind: 'topping',
        required: false,
        maxSelect: null,
        toppings: [
          { name: 'Trân châu', price: 5_000 },
          { name: 'Thạch', price: 4_000 },
        ],
      },
    ])
  })

  it('một topping nằm ở hai nhóm của nhóm món: cùng giá với phép chiếu cho máy bản cũ', () => {
    const optionGroups = [
      toppingRow('t2', 'Topping rẻ', [{ itemGid: 'i-tc', price: 4_000 }], { sortOrder: 2 }),
      toppingRow('t1', 'Topping', [{ itemGid: 'i-tc', price: 6_000 }, { itemGid: 'i-th', price: null }], { sortOrder: 1 }),
    ]
    const gids = ['t2', 't1']
    const moi = attachedOptionGroups(undefined, { optionGroupGids: gids }, { optionGroups, items }).flatMap((g) =>
      g.kind === 'topping' ? g.toppings : [],
    )
    expect(moi).toEqual(projectLegacyMenu(gids, optionGroups, items).toppingMenu)
    expect(moi).toEqual([
      { name: 'Trân châu', price: 6_000 },
      { name: 'Thạch', price: 3_000 },
    ])
  })

  it('nhóm tuỳ chọn thiếu maxSelect là chọn-một; mặc định gom từ nhóm tuỳ chọn', () => {
    const optionGroups = [
      choiceRow('b', 'Đường', ['50%', '100%'], { maxSelect: null, defaultChoice: '100%' }),
      choiceRow('n', 'Ghi chú nhanh', ['Ít ngọt', 'Mang ống hút'], { maxSelect: 2, sortOrder: 1 }),
    ]
    const groups = optionGroupsFor(undefined, { optionGroupGids: ['b', 'n'] }, { optionGroups, items })
    expect(groups.map((g) => g.maxSelect)).toEqual([1, 1, 2])
    expect(defaultOptions(groups)).toEqual(['100%'])
  })
})

describe('nhóm bắt buộc', () => {
  const size = { ...duong, gid: 'size', name: 'Size', choices: ['M', 'L'], required: true }
  const topping = {
    gid: 't',
    name: 'Topping',
    kind: 'topping',
    toppings: [{ name: 'Trân châu', price: 5_000 }],
    required: true,
    maxSelect: null,
  } satisfies SaleOptionGroup

  it('chưa chọn gì trong nhóm thì thiếu; nhóm không bắt buộc không bao giờ thiếu', () => {
    expect(isGroupMissing(size, [], [])).toBe(true)
    expect(isGroupMissing(size, ['L'], [])).toBe(false)
    expect(isGroupMissing(duong, [], [])).toBe(false)
    expect(isGroupMissing(topping, [], [])).toBe(true)
    expect(isGroupMissing(topping, [], [{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }])).toBe(false)
  })

  it('đếm số loại topping đang chọn, không đếm số phần', () => {
    expect(selectedCount(topping, [], [{ name: 'Trân châu', unitPrice: 5_000, qty: 3 }])).toBe(1)
  })
})

describe('toggleOption', () => {
  it('chọn một lựa chọn rồi bấm lại thì gỡ', () => {
    expect(toggleOption([], duong, 'Ít đường')).toEqual(['Ít đường'])
    expect(toggleOption(['Ít đường'], duong, 'Ít đường')).toEqual([])
  })

  it('trong một nhóm chỉ có một lựa chọn: chọn cái khác thì THAY, nhãn của nhóm khác giữ nguyên', () => {
    expect(toggleOption(['Đá riêng', 'Ít đường'], duong, 'Không đường')).toEqual(['Đá riêng', 'Không đường'])
  })

  it('hai nhóm độc lập nhau', () => {
    const afterIce = toggleOption(['Ít đường'], ICE, 'Đá chung')
    expect(afterIce).toEqual(['Ít đường', 'Đá chung'])
    expect(toggleOption(afterIce, ICE, 'Đá riêng')).toEqual(['Ít đường', 'Đá riêng'])
  })

  it('nhóm chọn-nhiều: bấm là thêm hay gỡ đúng mục đó, đủ số thì mục mới không vào', () => {
    const nhanh = { choices: ['Ít ngọt', 'Mang ống hút', 'Không nắp'], maxSelect: 2 }
    const one = toggleOption(['Đá riêng'], nhanh, 'Ít ngọt')
    const two = toggleOption(one, nhanh, 'Mang ống hút')
    expect(two).toEqual(['Đá riêng', 'Ít ngọt', 'Mang ống hút'])
    expect(toggleOption(two, nhanh, 'Không nắp')).toEqual(two)
    expect(toggleOption(two, nhanh, 'Ít ngọt')).toEqual(['Đá riêng', 'Mang ống hút'])
  })
})

describe('orphanOptions', () => {
  it('nhãn không thuộc nhóm nào (nhóm đã bị xoá, đơn cũ) vẫn lộ ra để gỡ được', () => {
    expect(orphanOptions(['Ít đường', 'Giảm trà'], [duong])).toEqual(['Giảm trà'])
    expect(orphanOptions([], [duong])).toEqual([])
  })
})

describe('setToppingQty', () => {
  const tranChau = { name: 'Trân châu', price: 5_000 }

  it('thêm lần đầu lấy giá thực đơn, tăng số phần giữ NGUYÊN giá lúc chọn dù thực đơn đã đổi giá', () => {
    const one = setToppingQty([], tranChau, 1)
    expect(one).toEqual([{ name: 'Trân châu', unitPrice: 5_000, qty: 1 }])

    const repriced = { name: 'Trân châu', price: 9_000 }
    expect(setToppingQty(one, repriced, 2)).toEqual([{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }])
  })

  it('số phần 0 hoặc âm thì gỡ topping, topping khác nguyên vẹn', () => {
    const both = [
      { name: 'Trân châu', unitPrice: 5_000, qty: 2 },
      { name: 'Thạch', unitPrice: 3_000, qty: 1 },
    ]
    expect(setToppingQty(both, tranChau, 0)).toEqual([{ name: 'Thạch', unitPrice: 3_000, qty: 1 }])
    expect(setToppingQty(both, tranChau, -1)).toHaveLength(1)
  })
})

describe('nhãn topping', () => {
  it('một phần thì chỉ tên, từ hai phần có "x2"; tiền = giá × số phần', () => {
    expect(toppingLabel({ name: 'Thạch', qty: 1 })).toBe('Thạch')
    expect(toppingLabel({ name: 'Trân châu', qty: 2 })).toBe('Trân châu x2')
    expect(toppingAmount({ unitPrice: 5_000, qty: 2 })).toBe(10_000)
  })
})

describe('hasOptions', () => {
  it('nhóm Đá có sẵn không tính; nhóm tuỳ chọn hay topping gắn vào món hoặc nhóm món thì tính', () => {
    const items = [toppingItem('i-th', 'Thạch', 3_000)]
    const optionGroups = [choiceRow('b', 'Đường', ['50%']), toppingRow('t', 'Topping', [{ itemGid: 'i-th', price: null }])]
    expect(hasOptions(optionGroupsFor(undefined, undefined, { optionGroups, items }))).toBe(false)
    expect(hasOptions(optionGroupsFor({ optionGroupGids: ['b'] }, undefined, { optionGroups, items }))).toBe(true)
    expect(hasOptions(optionGroupsFor(undefined, { optionGroupGids: ['t'] }, { optionGroups, items }))).toBe(true)
    expect(hasOptions(optionGroupsFor(undefined, { optionGroupGids: ['t'] }, { optionGroups, items: [] }))).toBe(false)
  })
})

describe('toggleNotePhrase', () => {
  it('thêm cụm vào cuối, ngăn bằng dấu phẩy', () => {
    expect(toggleNotePhrase('', 'mang về')).toBe('mang về')
    expect(toggleNotePhrase('không hành', 'mang về')).toBe('không hành, mang về')
  })

  it('bấm lại thì gỡ đúng cụm đó, không phân biệt hoa thường, chữ tự gõ còn nguyên', () => {
    expect(toggleNotePhrase('không hành, Mang về, gói kỹ nhé', 'mang về')).toBe('không hành, gói kỹ nhé')
    expect(hasNotePhrase('không hành, Mang về', 'mang về')).toBe(true)
    expect(hasNotePhrase('mang về sau', 'mang về')).toBe(false)
  })

  it('dấu phẩy thập phân không phải chỗ ngăn cụm', () => {
    expect(toggleNotePhrase('thêm 1,5 lạng', 'mang về')).toBe('thêm 1,5 lạng, mang về')
    expect(toggleNotePhrase('thêm 1,5 lạng, mang về', 'mang về')).toBe('thêm 1,5 lạng')
    expect(recentNotePhrases(['thêm 1,5 lạng'], 6)).toEqual(['thêm 1,5 lạng'])
  })
})

describe('recentNotePhrases', () => {
  it('xếp theo số lần dùng, hoà thì cụm gần hơn đứng trước, giữ cách viết của lần gần nhất', () => {
    const notes = ['Mang về', 'ít đá', 'không hành, mang về', '', 'ít đá, cay']
    expect(recentNotePhrases(notes, 6)).toEqual(['Mang về', 'ít đá', 'không hành', 'cay'])
    expect(recentNotePhrases(notes, 2)).toEqual(['Mang về', 'ít đá'])
    expect(recentNotePhrases([], 6)).toEqual([])
  })

  it('bỏ cụm trùng một lựa chọn đã có chip riêng (ghi chú đá của bản cũ) trước khi cắt giới hạn', () => {
    const notes = ['Đá riêng', 'đá riêng, mang về', 'Đá chung', 'ít hành']
    expect(recentNotePhrases(notes, 2, ['Đá chung', 'Đá riêng'])).toEqual(['mang về', 'ít hành'])
  })

  it('bỏ cụm dài hơn giới hạn chip trước khi cắt số lượng', () => {
    const notes = ['không lấy ống hút để đá riêng ra túi nylon gói kỹ giúp em', 'cay', 'mang về']
    expect(recentNotePhrases(notes, 2, [], 24)).toEqual(['cay', 'mang về'])
  })
})
