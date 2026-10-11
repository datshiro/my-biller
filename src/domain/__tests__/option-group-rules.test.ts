import { describe, expect, it } from 'vitest'
import { OptionGroupPayloadSchema, OptionGroupRowSchema } from '@shared/ledger-schemas'
import {
  catalogClash,
  labelClash,
  OPTION_GROUP_TEMPLATES,
  parseChoices,
  placesUsing,
} from '../option-group-rules'
import type { OptionGroupRow } from '../schema'
import { testGid } from '@/test-fixtures'

const choiceGroup = (gid: string, name: string, choices: string[], over: Record<string, unknown> = {}): OptionGroupRow =>
  OptionGroupRowSchema.parse({
    gid,
    name,
    kind: 'choice',
    choices,
    required: 0,
    maxSelect: 1,
    defaultChoice: null,
    sortOrder: 1,
    isActive: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

const toppingGroup = (gid: string, name: string, itemGids: string[], over: Record<string, unknown> = {}): OptionGroupRow =>
  OptionGroupRowSchema.parse({
    gid,
    name,
    kind: 'topping',
    toppings: itemGids.map((itemGid) => ({ itemGid, price: null })),
    required: 0,
    maxSelect: null,
    defaultChoice: null,
    sortOrder: 2,
    isActive: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

const catalogItem = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: n,
  gid: testGid(n),
  name,
  kind: 'item' as const,
  groupId: null as number | null,
  optionGroupGids: [] as string[],
  ...over,
})

describe('ba mẫu nhóm lựa chọn', () => {
  it.each(OPTION_GROUP_TEMPLATES.map((template) => [template.name, template] as const))(
    'mẫu %s qua schema khi có đủ trường lưu',
    (_, template) => {
      const result = OptionGroupPayloadSchema.safeParse({
        ...template,
        gid: testGid(1),
        required: 0,
        sortOrder: 0,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      expect(result.success).toBe(true)
    },
  )

  it('nhãn của ba mẫu không trùng nhau và không trùng hằng Đá', () => {
    const labels = OPTION_GROUP_TEMPLATES.flatMap((template) => template.choices)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).not.toContain('Đá chung')
    expect(labels).not.toContain('Đá riêng')
  })

  it('ba mẫu gắn cùng một món thì không báo nhãn trùng', () => {
    const rows = OPTION_GROUP_TEMPLATES.map((template, index) =>
      choiceGroup(testGid(10 + index), template.name, [...template.choices], {
        maxSelect: template.maxSelect,
        defaultChoice: template.defaultChoice,
      }),
    )
    expect(labelClash(rows, [])).toBeNull()
  })
})

describe('labelClash', () => {
  it('hai nhóm tuỳ chọn cùng có một lựa chọn thì báo cả hai tên nhóm', () => {
    const sugar = choiceGroup(testGid(1), 'Đường', ['Ít đường', 'Không đường'])
    const level = choiceGroup(testGid(2), 'Mức ngọt', ['Ít đường', 'Đường đầy'])
    expect(labelClash([sugar, level], [])).toBe(
      'Lựa chọn “Ít đường” có ở cả nhóm “Đường” và “Mức ngọt” — mỗi lựa chọn chỉ thuộc một nhóm.',
    )
  })

  it('lựa chọn trùng hằng Đá có sẵn thì báo nhóm Đá có sẵn', () => {
    const ice = choiceGroup(testGid(1), 'Kiểu đá', ['Đá riêng'])
    expect(labelClash([ice], [])).toBe(
      'Lựa chọn “Đá riêng” đã có ở nhóm Đá có sẵn cho mọi món — mỗi lựa chọn chỉ thuộc một nhóm.',
    )
  })

  it('topping cùng tên giữa hai nhóm topping, khác hoa thường và khoảng trắng thì báo tên topping', () => {
    const tea = toppingGroup(testGid(1), 'Topping trà', [testGid(41)])
    const milk = toppingGroup(testGid(2), 'Topping sữa', [testGid(42)])
    const items = [catalogItem(41, 'Trân châu'), catalogItem(42, 'trân châu ')]
    expect(labelClash([tea, milk], items)).toBe('Topping “trân châu” có ở cả nhóm “Topping trà” và “Topping sữa”.')
  })

  it('nhóm đã lưu trữ không tính vào nhãn trùng', () => {
    const active = choiceGroup(testGid(1), 'Đường', ['Ít đường'])
    const archived = choiceGroup(testGid(2), 'Mức ngọt', ['Ít đường'], { isActive: 0 })
    expect(labelClash([active, archived], [])).toBeNull()
  })

  it('topping trỏ tới món không còn trong danh mục thì bỏ qua, không báo', () => {
    const tea = toppingGroup(testGid(1), 'Topping trà', [testGid(41)])
    const milk = toppingGroup(testGid(2), 'Topping sữa', [testGid(99)])
    expect(labelClash([tea, milk], [catalogItem(41, 'Trân châu')])).toBeNull()
  })

  it('các nhãn khác nhau thì không báo', () => {
    const sugar = choiceGroup(testGid(1), 'Đường', ['Ít đường'])
    const size = choiceGroup(testGid(2), 'Size', ['Nhỏ', 'Lớn'])
    expect(labelClash([sugar, size], [])).toBeNull()
  })
})

describe('catalogClash', () => {
  const sugar = choiceGroup(testGid(1), 'Đường', ['Ít đường', 'Không đường'])
  const level = choiceGroup(testGid(2), 'Mức ngọt', ['Ít đường', 'Đường đầy'])
  const drinks = { id: 1, name: 'Đồ uống' }
  const EMPTY = { optionGroups: [], items: [], itemGroups: [] }

  it('nhóm món gắn hai nhóm trùng nhãn thì báo tên nhóm món', () => {
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar, level],
        items: [],
        itemGroups: [{ ...drinks, optionGroupGids: [sugar.gid, level.gid] }],
      }),
    ).toBe(
      'Nhóm món “Đồ uống”: Lựa chọn “Ít đường” có ở cả nhóm “Đường” và “Mức ngọt” — mỗi lựa chọn chỉ thuộc một nhóm.',
    )
  })

  it('món gắn trực tiếp hai nhóm trùng nhãn thì báo tên món', () => {
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar, level],
        items: [catalogItem(51, 'Cà phê', { optionGroupGids: [sugar.gid, level.gid] })],
        itemGroups: [],
      }),
    ).toBe(
      'Món “Cà phê”: Lựa chọn “Ít đường” có ở cả nhóm “Đường” và “Mức ngọt” — mỗi lựa chọn chỉ thuộc một nhóm.',
    )
  })

  it('món trong nhóm nhận nhóm của nhóm món cộng nhóm gắn thẳng, trùng nhãn thì báo tên món', () => {
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar, level],
        items: [catalogItem(51, 'Cà phê', { groupId: 1, optionGroupGids: [level.gid] })],
        itemGroups: [{ ...drinks, optionGroupGids: [sugar.gid] }],
      }),
    ).toBe(
      'Món “Cà phê”: Lựa chọn “Ít đường” có ở cả nhóm “Mức ngọt” và “Đường” — mỗi lựa chọn chỉ thuộc một nhóm.',
    )
  })

  it('nhóm vừa gắn vào món vừa gắn vào nhóm món của món đó không tự báo trùng với chính nó', () => {
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar],
        items: [catalogItem(51, 'Cà phê', { groupId: 1, optionGroupGids: [sugar.gid] })],
        itemGroups: [{ ...drinks, optionGroupGids: [sugar.gid] }],
      }),
    ).toBeNull()
  })

  it('hai nhóm trùng nhãn nhưng không gắn vào đâu thì không báo', () => {
    expect(catalogClash(EMPTY, { optionGroups: [sugar, level], items: [catalogItem(51, 'Cà phê')], itemGroups: [drinks] })).toBeNull()
  })

  it('nhóm đã lưu trữ đang gắn vào món thì không báo trùng', () => {
    const archived = choiceGroup(testGid(3), 'Mức ngọt cũ', ['Ít đường'], { isActive: 0 })
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar, archived],
        items: [catalogItem(51, 'Cà phê', { optionGroupGids: [sugar.gid, archived.gid] })],
        itemGroups: [],
      }),
    ).toBeNull()
  })

  it('gid trỏ tới nhóm không còn tồn tại, hoặc món trỏ tới nhóm món đã xoá, thì bỏ qua không lỗi', () => {
    expect(
      catalogClash(EMPTY, {
        optionGroups: [sugar],
        items: [catalogItem(51, 'Cà phê', { groupId: 7, optionGroupGids: [sugar.gid, testGid(99)] })],
        itemGroups: [],
      }),
    ).toBeNull()
  })
})

describe('catalogClash chỉ báo chỗ trùng do chính thay đổi gây ra', () => {
  const sugar = choiceGroup(testGid(1), 'Đường', ['Ít đường'])
  const level = choiceGroup(testGid(2), 'Mức ngọt', ['Ít đường'])
  const before = {
    optionGroups: [sugar, level],
    items: [catalogItem(51, 'Trà sữa', { optionGroupGids: [sugar.gid, level.gid] }), catalogItem(52, 'Phở bò')],
    itemGroups: [],
  }

  it('chỗ trùng có sẵn ở món khác không chặn sửa một món không liên quan', () => {
    const after = {
      ...before,
      items: [before.items[0]!, catalogItem(52, 'Phở bò tái', { optionGroupGids: [] })],
    }
    expect(catalogClash(before, after)).toBeNull()
  })

  it('thay đổi tạo thêm chỗ trùng mới thì vẫn báo chỗ mới', () => {
    const after = { ...before, items: [before.items[0]!, catalogItem(52, 'Phở bò', { optionGroupGids: [sugar.gid, level.gid] })] }
    expect(catalogClash(before, after)).toMatch(/^Món “Phở bò”: /)
  })
})

describe('placesUsing', () => {
  const sugar = choiceGroup(testGid(1), 'Đường', ['Ít đường'])

  it('liệt kê nhóm món trước, rồi món gắn thẳng', () => {
    expect(
      placesUsing(sugar.gid, {
        items: [catalogItem(51, 'Cà phê', { optionGroupGids: [sugar.gid] }), catalogItem(52, 'Trà đá')],
        itemGroups: [{ id: 1, name: 'Đồ uống', optionGroupGids: [sugar.gid] }],
      }),
    ).toEqual(['nhóm món “Đồ uống”', 'món “Cà phê”'])
  })

  it('chưa gắn đâu thì trả về danh sách rỗng', () => {
    expect(placesUsing(sugar.gid, { items: [catalogItem(52, 'Trà đá')], itemGroups: [] })).toEqual([])
  })
})

describe('parseChoices', () => {
  it('tách theo dấu phẩy, bỏ ô trống và mục trùng, giữ thứ tự xuất hiện đầu tiên', () => {
    expect(parseChoices(' Ít đường, Không đường,, Ít đường , ')).toEqual(['Ít đường', 'Không đường'])
    expect(parseChoices('B, A, B')).toEqual(['B', 'A'])
  })

  it('chuỗi chỉ có khoảng trắng và dấu phẩy thì ra danh sách rỗng', () => {
    expect(parseChoices('  ,  , ')).toEqual([])
  })
})
