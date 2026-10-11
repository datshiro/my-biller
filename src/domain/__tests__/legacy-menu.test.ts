import { describe, expect, it } from 'vitest'
import { deterministicGid, type NewOptionGroup } from '@shared/catalog-migration'
import { OptionGroupPayloadSchema } from '@shared/ledger-schemas'
import {
  planLegacyMenuEdit,
  projectLegacyMenu,
  sameLegacyMenu,
  type LegacyMenu,
  type LegacyMenuEdit,
  type LegacyMenuItem,
} from '@shared/legacy-menu'

const NOW = 1_700_000_000_000
const G = '11111111-1111-4111-8111-111111111111'
const CG = '22222222-2222-4222-8222-222222222222'
const TG = '33333333-3333-4333-8333-333333333333'
const TC = '44444444-4444-4444-8444-444444444444'
const TH = '55555555-5555-4555-8555-555555555555'
const TEA = '66666666-6666-4666-8666-666666666666'
const PUD = '77777777-7777-4777-8777-777777777777'
const MISSING = '99999999-9999-4999-8999-999999999999'
const OWN = deterministicGid(`toppings:${G}`)

const choice = (gid: string, name: string, choices: string[], extra: Record<string, unknown> = {}) =>
  ({
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
    ...extra,
  }) as NewOptionGroup

const topping = (gid: string, name: string, toppings: { itemGid: string; price: number | null }[], extra: Record<string, unknown> = {}) =>
  ({
    gid,
    name,
    kind: 'topping',
    toppings,
    required: 0,
    maxSelect: null,
    defaultChoice: null,
    sortOrder: 2,
    isActive: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }) as NewOptionGroup

const item = (gid: string, name: string, unitPrice: number, extra: Partial<LegacyMenuItem> = {}): LegacyMenuItem => ({
  gid,
  name,
  unitPrice,
  isActive: 0,
  kind: 'topping',
  createdAt: 1,
  ...extra,
})

const baseCatalog = (): NewOptionGroup[] => [
  choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1, defaultChoice: 'Không đường' }),
  topping(TG, 'Topping Trà sữa', [
    { itemGid: TC, price: null },
    { itemGid: TH, price: null },
  ]),
]
const baseItems = (): LegacyMenuItem[] => [
  item(TC, 'Trân châu', 5_000),
  item(TH, 'Thạch', 3_000),
  item(TEA, 'Trà sữa', 25_000, { kind: 'item', isActive: 1 }),
]
const BASE_MENU: LegacyMenu = {
  optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
  toppingMenu: [
    { name: 'Trân châu', price: 5_000 },
    { name: 'Thạch', price: 3_000 },
  ],
}
const menu = (patch: Partial<LegacyMenu>): LegacyMenu => ({ ...BASE_MENU, ...patch })

type Fixture = {
  group?: { gid: string; name: string; optionGroupGids: string[] }
  optionGroups?: NewOptionGroup[]
  items?: LegacyMenuItem[]
  otherAttachments?: string[][]
}

/** Dịch một sửa đổi của sheet máy cũ trên nhóm G, mặc định G gắn nhóm Đường và nhóm topping nền. */
function plan(before: LegacyMenu, after: LegacyMenu, fixture: Fixture = {}): LegacyMenuEdit {
  let counter = 0
  return planLegacyMenuEdit({
    group: fixture.group ?? { gid: G, name: 'Trà sữa', optionGroupGids: [CG, TG] },
    before,
    after,
    optionGroups: fixture.optionGroups ?? baseCatalog(),
    items: fixture.items ?? baseItems(),
    otherAttachments: fixture.otherAttachments ?? [],
    now: NOW,
    newGid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  })
}

type Translated = Extract<LegacyMenuEdit, { status: 'translated' }>

const toppingsOf = (group: NewOptionGroup | undefined) => (group?.kind === 'topping' ? group.toppings : [])
const choicesOf = (group: NewOptionGroup | undefined) => (group?.kind === 'choice' ? group.choices : [])

function translated(result: LegacyMenuEdit): Translated {
  expect(result.status).toBe('translated')
  return result as Translated
}

/** Mọi nhóm đưa ra phải qua đúng schema nhóm lựa chọn của bản mới — máy mới và Worker đều đọc bằng schema này. */
function expectSchemaValid(result: Translated) {
  for (const { after } of result.optionGroups) {
    expect(OptionGroupPayloadSchema.safeParse(after).success, after.name).toBe(true)
  }
}

describe('projectLegacyMenu', () => {
  it('trạng thái nền chiếu ra đúng thực đơn nền', () => {
    expect(projectLegacyMenu([CG, TG], baseCatalog(), baseItems())).toEqual(BASE_MENU)
  })

  it('xếp nhóm lựa chọn theo sortOrder chứ không theo thứ tự gắn; bỏ nhóm tắt và gid đã mất', () => {
    const size = '12121212-1212-4212-8212-121212121212'
    const off = '13131313-1313-4313-8313-131313131313'
    const menuOut = projectLegacyMenu(
      [CG, size, off, MISSING],
      [
        choice(CG, 'Đường', ['Ít'], { sortOrder: 9 }),
        choice(size, 'Size', ['Nhỏ'], { sortOrder: 1 }),
        choice(off, 'Đá', ['Đá chung'], { sortOrder: 0, isActive: 0 }),
      ],
      [],
    )
    expect(menuOut).toEqual({ optionGroups: [{ name: 'Size', choices: ['Nhỏ'] }, { name: 'Đường', choices: ['Ít'] }], toppingMenu: [] })
  })

  it('trùng tên nhóm lựa chọn: nhóm sortOrder nhỏ thắng dù gắn sau', () => {
    const later = '14141414-1414-4414-8414-141414141414'
    const menuOut = projectLegacyMenu(
      [CG, later],
      [choice(CG, 'Đường', ['Nhiều'], { sortOrder: 5 }), choice(later, 'ĐƯỜNG', ['Ít'], { sortOrder: 1 })],
      [],
    )
    expect(menuOut.optionGroups).toEqual([{ name: 'ĐƯỜNG', choices: ['Ít'] }])
  })

  it('trùng tên topping giữa hai nhóm: giá của nhóm sortOrder nhỏ thắng, tên lấy từ món thắng', () => {
    const TC2 = '15151515-1515-4515-8515-151515151515'
    const T2 = '16161616-1616-4616-8616-161616161616'
    const menuOut = projectLegacyMenu(
      [TG, T2],
      [
        topping(TG, 'Topping A', [{ itemGid: TC, price: 7_000 }], { sortOrder: 2 }),
        topping(T2, 'Topping B', [{ itemGid: TC2, price: 4_000 }], { sortOrder: 1 }),
      ],
      [item(TC, 'Trân châu', 5_000), item(TC2, 'TRÂN CHÂU', 5_000)],
    )
    expect(menuOut.toppingMenu).toEqual([{ name: 'TRÂN CHÂU', price: 4_000 }])
  })

  it('bỏ topping trỏ món không phải topping, món mất hoặc tên rỗng; giá null lấy giá của món', () => {
    const EMPTY = '17171717-1717-4717-8717-171717171717'
    const menuOut = projectLegacyMenu(
      [TG],
      [
        topping(TG, 'Topping Trà sữa', [
          { itemGid: TC, price: null },
          { itemGid: TH, price: 4_000 },
          { itemGid: TEA, price: 1_000 },
          { itemGid: MISSING, price: 1_000 },
          { itemGid: EMPTY, price: 1_000 },
        ]),
      ],
      [...baseItems(), item(EMPTY, '   ', 1_000)],
    )
    expect(menuOut.toppingMenu).toEqual([
      { name: 'Trân châu', price: 5_000 },
      { name: 'Thạch', price: 4_000 },
    ])
  })
})

describe('planLegacyMenuEdit', () => {
  it('đổi thứ tự thực đơn hoặc khác khoảng trắng và dạng Unicode của cùng tên: không có gì để dịch', () => {
    expect(plan(BASE_MENU, menu({ toppingMenu: [...BASE_MENU.toppingMenu].reverse() }))).toEqual({ status: 'unchanged' })
    expect(
      plan(
        BASE_MENU,
        menu({
          optionGroups: [{ name: '  Đường ', choices: ['Ít đường ', ' Không đường'] }],
          toppingMenu: [
            { name: 'Trân châu ', price: 5_000 },
            { name: 'Thạch', price: 3_000 },
          ],
        }),
      ),
    ).toEqual({ status: 'unchanged' })
  })

  it('thêm topping chưa có món: tạo món topping ẩn và nhóm topping riêng của G', () => {
    const pudding = deterministicGid('topping:pudding')
    const result = translated(plan(BASE_MENU, menu({ toppingMenu: [...BASE_MENU.toppingMenu, { name: 'Pudding', price: 8_000 }] })))
    expect(result.createItems).toEqual([
      expect.objectContaining({ gid: pudding, name: 'Pudding', unitPrice: 8_000, isActive: 0, kind: 'topping', costPrice: null }),
    ])
    expect(result.markToppings).toEqual([])
    expect(result.optionGroups).toEqual([
      {
        before: null,
        after: expect.objectContaining({ gid: OWN, name: 'Topping Trà sữa', kind: 'topping', isActive: 1, toppings: [{ itemGid: pudding, price: null }] }),
      },
    ])
    expect(result.optionGroupGids).toEqual([CG, TG, OWN])
    expectSchemaValid(result)
  })

  it('nhóm chưa gắn gì, thêm topping đầu tiên: nhóm topping riêng là nhóm duy nhất được gắn', () => {
    const result = translated(
      plan(
        { optionGroups: [], toppingMenu: [] },
        { optionGroups: [], toppingMenu: [{ name: 'Pudding', price: 8_000 }] },
        { group: { gid: G, name: 'Trà sữa', optionGroupGids: [] }, optionGroups: [], items: [] },
      ),
    )
    expect(result.createItems).toHaveLength(1)
    expect(result.optionGroupGids).toEqual([OWN])
    expectSchemaValid(result)
  })

  it('thêm topping trùng tên món thường đang bán: chỉ đánh dấu topping, không tạo món mới', () => {
    const result = translated(
      plan(
        BASE_MENU,
        menu({ toppingMenu: [...BASE_MENU.toppingMenu, { name: 'Pudding', price: 8_000 }] }),
        { items: [...baseItems(), item(PUD, 'Pudding', 8_000, { kind: 'item', isActive: 1 })] },
      ),
    )
    expect(result.createItems).toEqual([])
    expect(result.markToppings).toEqual([PUD])
    expect(toppingsOf(result.optionGroups[0]?.after)).toEqual([{ itemGid: PUD, price: null }])
  })

  it('thêm topping trùng tên món topping ẩn đã có: dùng lại món đó, không tạo món mới', () => {
    const result = translated(
      plan(
        BASE_MENU,
        menu({ toppingMenu: [...BASE_MENU.toppingMenu, { name: 'pudding', price: 9_000 }] }),
        { items: [...baseItems(), item(PUD, 'Pudding', 8_000)] },
      ),
    )
    expect(result.createItems).toEqual([])
    expect(result.markToppings).toEqual([])
    expect(toppingsOf(result.optionGroups[0]?.after)).toEqual([{ itemGid: PUD, price: 9_000 }])
  })

  it('thêm topping vào nhóm topping riêng đã gắn: sửa tại chỗ, không tạo nhóm thứ hai', () => {
    const result = translated(
      plan(
        BASE_MENU,
        menu({ toppingMenu: [...BASE_MENU.toppingMenu, { name: 'Pudding', price: 8_000 }] }),
        {
          group: { gid: G, name: 'Trà sữa', optionGroupGids: [CG, OWN] },
          optionGroups: [choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1 }), topping(OWN, 'Topping Trà sữa', [{ itemGid: TC, price: null }])],
        },
      ),
    )
    expect(result.optionGroups).toHaveLength(1)
    expect(result.optionGroups[0]?.before?.gid).toBe(OWN)
    expect(toppingsOf(result.optionGroups[0]?.after)).toHaveLength(2)
    expect(result.optionGroupGids).toEqual([CG, OWN])
  })

  it('bỏ topping làm nhóm topping rỗng: gỡ nhóm khỏi G, nhóm không còn trong optionGroupGids', () => {
    const result = translated(
      plan(BASE_MENU, menu({ toppingMenu: [{ name: 'Thạch', price: 3_000 }] }), {
        optionGroups: [choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1 }), topping(TG, 'Topping Trà sữa', [{ itemGid: TC, price: null }])],
      }),
    )
    expect(result.optionGroupGids).toEqual([CG])
    expect(result.optionGroups).toEqual([])
    expect(result.createItems).toEqual([])
  })

  it('bỏ topping mà sổ đã không còn nó (máy khác bỏ trước): sửa của sheet mở lâu bị bỏ, không dịch gì', () => {
    expect(
      plan(BASE_MENU, menu({ toppingMenu: [{ name: 'Trân châu', price: 5_000 }] }), {
        optionGroups: [choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1 }), topping(TG, 'Topping Trà sữa', [{ itemGid: TC, price: null }])],
      }),
    ).toEqual({ status: 'unchanged' })
  })

  it('đổi giá topping: sửa tại chỗ khi nhóm chỉ G dùng, giữ nguyên gid nhóm', () => {
    const result = translated(plan(BASE_MENU, menu({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }] })))
    expect(result.optionGroups).toEqual([
      {
        before: baseCatalog()[1],
        after: expect.objectContaining({ gid: TG, toppings: [{ itemGid: TC, price: 7_000 }, { itemGid: TH, price: null }] }),
      },
    ])
    expect(result.optionGroupGids).toEqual([CG, TG])
    expectSchemaValid(result)
  })

  it('đổi giá topping về đúng giá của món: lưu price null để giá tiếp tục theo món', () => {
    const result = translated(
      plan(
        menu({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }] }),
        BASE_MENU,
        {
          optionGroups: [choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1 }), topping(TG, 'Topping Trà sữa', [{ itemGid: TC, price: 7_000 }, { itemGid: TH, price: null }])],
        },
      ),
    )
    expect(toppingsOf(result.optionGroups[0]?.after)).toEqual([{ itemGid: TC, price: null }, { itemGid: TH, price: null }])
  })

  it('nhóm topping dùng chung với nhóm món khác: sao-khi-ghi, G nhận bản sao đã sửa, nhóm dùng chung giữ nguyên', () => {
    const catalog = baseCatalog()
    const result = translated(
      plan(BASE_MENU, menu({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }] }), {
        optionGroups: catalog,
        otherAttachments: [[TG]],
      }),
    )
    const copy = result.optionGroups[0]!.after
    expect(result.optionGroups).toEqual([{ before: null, after: expect.objectContaining({ name: 'Topping Trà sữa (Trà sữa)', kind: 'topping' }) }])
    expect(copy.gid).not.toBe(TG)
    expect(toppingsOf(copy)).toEqual([{ itemGid: TC, price: 7_000 }, { itemGid: TH, price: null }])
    expect(result.optionGroupGids).toEqual([CG, copy.gid])
    expect(catalog[1]).toMatchObject({ gid: TG, toppings: [{ itemGid: TC, price: null }, { itemGid: TH, price: null }] })
    expectSchemaValid(result)
  })

  it('hai thao tác liên tiếp trên cùng nhóm dùng chung chỉ tạo đúng một bản sao', () => {
    const result = translated(
      plan(BASE_MENU, menu({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }] }), { otherAttachments: [[TG]] }),
    )
    expect(result.optionGroups).toHaveLength(1)
    expect(toppingsOf(result.optionGroups[0]?.after)).toEqual([{ itemGid: TC, price: 7_000 }])
    expect(result.optionGroupGids).toHaveLength(2)
    expect(result.optionGroupGids[0]).toBe(CG)
  })

  it('lựa chọn sửa trong nhóm lựa chọn dùng chung: sao-khi-ghi, nhóm gốc giữ nguyên lựa chọn', () => {
    const catalog = baseCatalog()
    const result = translated(
      plan(
        BASE_MENU,
        menu({ optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường', 'Nhiều đường'] }] }),
        { optionGroups: catalog, otherAttachments: [[CG]] },
      ),
    )
    expect(result.optionGroups).toEqual([
      { before: null, after: expect.objectContaining({ name: 'Đường (Trà sữa)', kind: 'choice', choices: ['Ít đường', 'Không đường', 'Nhiều đường'] }) },
    ])
    expect(result.optionGroupGids).toEqual([result.optionGroups[0]!.after.gid, TG])
    expect(catalog[0]).toMatchObject({ gid: CG, choices: ['Ít đường', 'Không đường'] })
    expectSchemaValid(result)
  })

  it('nhóm lựa chọn mới: tạo choice maxSelect 1 và gắn vào G sau các nhóm cũ', () => {
    const result = translated(
      plan(BASE_MENU, menu({ optionGroups: [...BASE_MENU.optionGroups, { name: 'Size', choices: ['Nhỏ', 'Lớn'] }] })),
    )
    expect(result.optionGroups).toEqual([
      {
        before: null,
        after: expect.objectContaining({ name: 'Size', kind: 'choice', choices: ['Nhỏ', 'Lớn'], maxSelect: 1, required: 0, defaultChoice: null, isActive: 1 }),
      },
    ])
    const created = result.optionGroups[0]!.after
    expect(created.sortOrder).toBeGreaterThan(2)
    expect(result.optionGroupGids).toEqual([CG, TG, created.gid])
    expectSchemaValid(result)
  })

  it('nhóm lựa chọn bị bỏ: gỡ khỏi G, bản trong sổ giữ nguyên', () => {
    const result = translated(plan(BASE_MENU, menu({ optionGroups: [] })))
    expect(result.optionGroupGids).toEqual([TG])
    expect(result.optionGroups).toEqual([])
  })

  it('sửa lựa chọn: làm sạch defaultChoice đã bị bỏ và hạ maxSelect về số lựa chọn còn lại', () => {
    const result = translated(
      plan(BASE_MENU, menu({ optionGroups: [{ name: 'Đường', choices: ['Ít đường'] }] }), {
        optionGroups: [choice(CG, 'Đường', ['Ít đường', 'Không đường'], { sortOrder: 1, maxSelect: 2, defaultChoice: 'Không đường' }), topping(TG, 'Topping Trà sữa', [{ itemGid: TC, price: null }, { itemGid: TH, price: null }])],
      }),
    )
    expect(result.optionGroups[0]?.after).toMatchObject({ gid: CG, choices: ['Ít đường'], maxSelect: 1, defaultChoice: null })
    expectSchemaValid(result)
  })

  it('đổi thứ tự lựa chọn bên trong một nhóm là thay đổi thật: dịch sang thứ tự mới', () => {
    const result = translated(plan(BASE_MENU, menu({ optionGroups: [{ name: 'Đường', choices: ['Không đường', 'Ít đường'] }] })))
    expect(choicesOf(result.optionGroups[0]?.after)).toEqual(['Không đường', 'Ít đường'])
  })

  it('diff theo phần tử: chỉ dịch phần tử máy cũ sửa, phần tử máy mới đã đổi (before lệch sổ) được giữ', () => {
    const result = translated(
      plan(
        menu({ toppingMenu: [{ name: 'Trân châu', price: 9_000 }, { name: 'Thạch', price: 3_000 }] }),
        menu({ toppingMenu: [{ name: 'Trân châu', price: 9_500 }, { name: 'Thạch', price: 4_000 }] }),
      ),
    )
    expect(toppingsOf(result.optionGroups[0]?.after)).toEqual([{ itemGid: TC, price: null }, { itemGid: TH, price: 4_000 }])
  })

  it('phần tử before khớp sổ nhưng bị máy khác sửa rồi: ưu tiên sổ, sửa của sheet mở lâu bị bỏ', () => {
    expect(
      plan(
        menu({ toppingMenu: [{ name: 'Trân châu', price: 9_000 }, { name: 'Thạch', price: 3_000 }] }),
        menu({ toppingMenu: [{ name: 'Trân châu', price: 9_500 }, { name: 'Thạch', price: 3_000 }] }),
      ),
    ).toEqual({ status: 'unchanged' })
  })

  it('vượt giới hạn tên topping (41 ký tự): skipped với lý do, không ném', () => {
    const result = plan(BASE_MENU, menu({ toppingMenu: [...BASE_MENU.toppingMenu, { name: 'a'.repeat(41), price: 1_000 }] }))
    expect(result).toMatchObject({ status: 'skipped', reason: expect.stringContaining('dài quá 40') })
  })

  it('vượt giới hạn tên nhóm lựa chọn và nhãn lựa chọn (41 ký tự): skipped', () => {
    expect(plan(BASE_MENU, menu({ optionGroups: [{ name: 'b'.repeat(41), choices: ['Ít'] }] }))).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('dài quá 40'),
    })
    expect(plan(BASE_MENU, menu({ optionGroups: [{ name: 'Đường', choices: ['c'.repeat(41)] }] }))).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('dài quá 40'),
    })
  })

  it('vượt 30 lựa chọn trong một nhóm: skipped; đúng 30 thì được dịch', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `Lựa chọn ${i}`)
    expect(plan(BASE_MENU, menu({ optionGroups: [{ name: 'Đường', choices: thirty }] }))).toMatchObject({ status: 'translated' })
    expect(plan(BASE_MENU, menu({ optionGroups: [{ name: 'Đường', choices: [...thirty, 'Thừa'] }] }))).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('quá 30 lựa chọn'),
    })
  })

  it('vượt 30 topping trong một nhóm: skipped (schema bản mới); đúng 30 thì được dịch', () => {
    const topping30 = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `Topping ${i}`, price: 1_000 }))
    expect(plan(BASE_MENU, menu({ toppingMenu: [...BASE_MENU.toppingMenu, ...topping30(30)] }))).toMatchObject({ status: 'translated' })
    expect(plan(BASE_MENU, menu({ toppingMenu: [...BASE_MENU.toppingMenu, ...topping30(31)] }))).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('vượt giới hạn của bản mới'),
    })
  })

  it('gắn quá 20 nhóm lựa chọn: thêm một nhóm mới làm vượt, skipped', () => {
    const ids = Array.from({ length: 20 }, (_, i) => deterministicGid(`choice-fixture:${i}`))
    const groups = ids.map((gid, i) => choice(gid, `Nhóm ${i}`, ['A'], { sortOrder: i }))
    const before = { optionGroups: groups.map((group) => ({ name: group.name, choices: ['A'] })), toppingMenu: [] }
    expect(
      plan(before, { ...before, optionGroups: [...before.optionGroups, { name: 'Size', choices: ['Nhỏ'] }] }, {
        group: { gid: G, name: 'Trà sữa', optionGroupGids: ids },
        optionGroups: groups,
        items: [],
      }),
    ).toMatchObject({ status: 'skipped', reason: expect.stringContaining('gắn quá 20') })
  })
})

describe('phép chiếu ổn định và không hồi sinh nhóm chủ quán đã tắt', () => {
  it('tên món dư khoảng trắng: phép chiếu trim như schema nên chiếu lại trên bản đã lưu không ra khác', () => {
    const items = [item(TC, '  Trân châu ', 5_000), item(TH, 'Thạch', 3_000)]
    const projected = projectLegacyMenu([TG], baseCatalog(), items)
    expect(projected.toppingMenu[0]).toEqual({ name: 'Trân châu', price: 5_000 })
    expect(sameLegacyMenu(projected, projectLegacyMenu([TG], baseCatalog(), items))).toBe(true)
  })

  it('nhóm topping riêng của G đang tắt: máy cũ thêm topping thì tạo nhóm mới chỉ chứa topping đó, nhóm tắt giữ nguyên', () => {
    const own = topping(OWN, 'Topping Trà sữa', [{ itemGid: TC, price: null }], { isActive: 0 })
    const result = translated(
      plan(
        { optionGroups: [], toppingMenu: [] },
        { optionGroups: [], toppingMenu: [{ name: 'Pudding', price: 7_000 }] },
        {
          group: { gid: G, name: 'Trà sữa', optionGroupGids: [OWN] },
          optionGroups: [own],
          items: [item(TC, 'Trân châu', 5_000), item(PUD, 'Pudding', 7_000)],
        },
      ),
    )
    expectSchemaValid(result)
    expect(result.optionGroups.some(({ after }) => after.gid === OWN)).toBe(false)
    const created = result.optionGroups.find(({ before }) => before === null)!.after
    expect(created.isActive).toBe(1)
    expect(toppingsOf(created)).toEqual([{ itemGid: PUD, price: null }])
    expect(result.optionGroupGids).toEqual([OWN, created.gid])
  })
})
