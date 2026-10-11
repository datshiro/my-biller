import { describe, expect, it } from 'vitest'
import {
  deterministicGid,
  isEmptyCatalogMigrationPlan,
  planCatalogMigration,
  uuidV5,
  type CatalogMigrationPlan,
  type MigrationGroup,
  type MigrationItem,
  type MigrationOptionGroup,
} from '@shared/catalog-migration'
import { ItemSchema, OptionGroupPayloadSchema } from '@shared/ledger-schemas'
import { z } from 'zod'

const NOW = 1_700_000_000_000
const group = (gid: string, extra: Partial<MigrationGroup> = {}): MigrationGroup => ({
  gid,
  name: 'Trà sữa',
  sortOrder: 1,
  optionGroups: [],
  toppingMenu: [],
  ...extra,
})
const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'

/** Áp kế hoạch lên đầu vào như Worker/máy cục bộ làm, để thử chạy lại. */
function applyPlan(
  groups: MigrationGroup[],
  items: MigrationItem[],
  optionGroups: MigrationOptionGroup[],
  plan: CatalogMigrationPlan,
) {
  const attach = new Map(plan.attach.map((entry) => [entry.groupGid, entry.optionGroupGids]))
  return {
    groups: groups.map((row) => (attach.has(row.gid) ? { ...row, optionGroupGids: attach.get(row.gid) } : row)),
    items: [
      ...items.map((row) => (plan.markToppings.includes(row.gid) ? { ...row, kind: 'topping' } : row)),
      ...plan.createItems,
    ],
    optionGroups: [...optionGroups, ...plan.createOptionGroups],
  }
}

describe('uuidV5', () => {
  it('khớp vector chuẩn RFC 4122 (namespace DNS)', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })

  it('SHA-1 thuần khớp crypto.subtle, kể cả chuỗi rỗng, chữ có dấu và chuỗi vượt một khối; ra gid hợp lệ', async () => {
    const ns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    for (const name of ['', 'abc', 'topping:trân châu', 'x'.repeat(55), 'đá '.repeat(40)]) {
      const nsBytes = Uint8Array.from(ns.replace(/-/g, '').match(/../g)!.map((hex) => parseInt(hex, 16)))
      const input = new Uint8Array([...nsBytes, ...new TextEncoder().encode(name)])
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16)
      hash[6] = (hash[6]! & 0x0f) | 0x50
      hash[8] = (hash[8]! & 0x3f) | 0x80
      const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      expect(uuidV5(name, ns)).toBe(expected)
      expect(z.string().uuid().safeParse(uuidV5(name, ns)).success).toBe(true)
    }
  })

  it('băm được chuỗi dài hơn một khối SHA-1 và chữ có dấu', () => {
    const long = 'topping:' + 'trân châu đen '.repeat(20)
    expect(deterministicGid(long)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(deterministicGid(long)).toBe(deterministicGid(long))
    expect(deterministicGid('topping:a')).not.toBe(deterministicGid('topping:b'))
  })
})

describe('planCatalogMigration', () => {
  it('chuyển topping và tuỳ chọn của một nhóm thành món topping chỉ bán kèm và nhóm lựa chọn', () => {
    const plan = planCatalogMigration({
      groups: [
        group(G1, {
          optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
          toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
        }),
      ],
      items: [],
      optionGroups: [],
      now: NOW,
    })

    const toppingGid = deterministicGid('topping:trân châu')
    expect(plan.createItems).toEqual([
      expect.objectContaining({ gid: toppingGid, name: 'Trân châu', unitPrice: 5_000, isActive: 0, kind: 'topping' }),
    ])
    expect(ItemSchema.omit({ id: true, groupId: true }).safeParse(plan.createItems[0]).success).toBe(true)
    const choice = plan.createOptionGroups.find((row) => row.kind === 'choice')
    const topping = plan.createOptionGroups.find((row) => row.kind === 'topping')
    expect(choice).toMatchObject({ name: 'Đường', choices: ['Ít đường', 'Không đường'], maxSelect: 1, required: 0, isActive: 1 })
    expect(topping).toMatchObject({ name: 'Topping Trà sữa', toppings: [{ itemGid: toppingGid, price: null }] })
    for (const row of plan.createOptionGroups) expect(OptionGroupPayloadSchema.safeParse(row).success).toBe(true)
    expect(plan.attach).toEqual([{ groupGid: G1, optionGroupGids: [choice!.gid, topping!.gid] }])
    expect(plan.markToppings).toEqual([])
  })

  it('chạy lại trên kết quả của chính nó cho kế hoạch rỗng', () => {
    const input = {
      groups: [group(G1, { toppingMenu: [{ name: 'Trân châu', price: 5_000 }], optionGroups: [{ name: 'Đá', choices: ['Ít đá'] }] })],
      items: [] as MigrationItem[],
      optionGroups: [] as MigrationOptionGroup[],
    }
    const first = planCatalogMigration({ ...input, now: NOW })
    const after = applyPlan(input.groups, input.items, input.optionGroups, first)
    expect(isEmptyCatalogMigrationPlan(planCatalogMigration({ ...after, now: NOW + 1 }))).toBe(true)
  })

  it('món đang bán trùng tên topping chỉ được đánh dấu topping, giữ nguyên đang bán và giá', () => {
    const existing: MigrationItem = { gid: '33333333-3333-4333-8333-333333333333', name: 'TRÂN CHÂU ', unitPrice: 7_000, isActive: 1 }
    const plan = planCatalogMigration({
      groups: [group(G1, { toppingMenu: [{ name: 'Trân châu', price: 5_000 }] })],
      items: [existing],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.createItems).toEqual([])
    expect(plan.markToppings).toEqual([existing.gid])
    expect(plan.createOptionGroups[0]).toMatchObject({ toppings: [{ itemGid: existing.gid, price: 5_000 }] })
  })

  it('một topping ở nhiều nhóm với giá khác nhau: một món, giá phổ biến nhất (hoà lấy thấp), nhóm lệch giá giữ giá riêng', () => {
    const plan = planCatalogMigration({
      groups: [
        group(G1, { sortOrder: 1, toppingMenu: [{ name: 'Thạch', price: 6_000 }] }),
        group(G2, { sortOrder: 2, name: 'Cà phê', toppingMenu: [{ name: 'thạch', price: 4_000 }] }),
      ],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.createItems).toHaveLength(1)
    expect(plan.createItems[0]).toMatchObject({ name: 'Thạch', unitPrice: 4_000 })
    const byName = new Map(plan.createOptionGroups.map((row) => [row.name, row]))
    expect(byName.get('Topping Trà sữa')).toMatchObject({ toppings: [{ price: 6_000 }] })
    expect(byName.get('Topping Cà phê')).toMatchObject({ toppings: [{ price: null }] })
  })

  it('bỏ qua nhóm không có thực đơn và nhóm đã có optionGroupGids, kể cả mảng rỗng chủ quán chủ ý gỡ', () => {
    const plan = planCatalogMigration({
      groups: [
        group(G1),
        group(G2, { toppingMenu: [{ name: 'Trân châu', price: 5_000 }], optionGroupGids: [] }),
        group('44444444-4444-4444-8444-444444444444', { toppingMenu: [{ name: 'Pudding', price: 5_000 }], optionGroupGids: [G1] }),
      ],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(isEmptyCatalogMigrationPlan(plan)).toBe(true)
  })

  it('không ghi đè nhóm lựa chọn hay món đích đã có (chủ quán sửa sau di trú), chỉ gắn lại gid', () => {
    const toppingGroupGid = deterministicGid(`toppings:${G1}`)
    const renamedTopping: MigrationItem = { gid: deterministicGid('topping:trân châu'), name: 'Trân châu đen', unitPrice: 9_000, isActive: 1, kind: 'topping' }
    const plan = planCatalogMigration({
      groups: [group(G1, { toppingMenu: [{ name: 'Trân châu', price: 5_000 }] })],
      items: [renamedTopping],
      optionGroups: [{ gid: toppingGroupGid, sortOrder: 7 }],
      now: NOW,
    })
    expect(plan.createItems).toEqual([])
    expect(plan.markToppings).toEqual([])
    expect(plan.createOptionGroups).toEqual([])
    expect(plan.attach).toEqual([{ groupGid: G1, optionGroupGids: [toppingGroupGid] }])
  })

  it('gid chỉ phụ thuộc gid thực thể và tên: hai lần chạy độc lập (Worker, máy cục bộ) ra cùng gid', () => {
    const input = { groups: [group(G1, { toppingMenu: [{ name: 'Trân châu', price: 5_000 }] })], items: [], optionGroups: [] }
    const a = planCatalogMigration({ ...input, now: NOW })
    const b = planCatalogMigration({ ...input, now: NOW + 99 })
    expect(a.createItems.map((row) => row.gid)).toEqual(b.createItems.map((row) => row.gid))
    expect(a.createOptionGroups.map((row) => row.gid)).toEqual(b.createOptionGroups.map((row) => row.gid))
  })

  it('cắt dữ liệu cũ vượt giới hạn schema mới thay vì ném lỗi; nhóm trùng tên chỉ giữ cái đầu', () => {
    const long = 'Rất nhiều chữ '.repeat(10)
    const choices = Array.from({ length: 40 }, (_, i) => `Lựa chọn ${i}`)
    const toppingMenu = Array.from({ length: 35 }, (_, i) => ({ name: `Topping ${i}`, price: 1_000 }))
    const optionGroups = [
      { name: long, choices: [...choices, 'Lựa chọn 0'] },
      { name: 'Đường', choices: ['Ít'] },
      { name: 'ĐƯỜNG', choices: ['Nhiều'] },
      ...Array.from({ length: 25 }, (_, i) => ({ name: `Nhóm ${i}`, choices: ['A'] })),
    ]
    const plan = planCatalogMigration({ groups: [group(G1, { name: long, optionGroups, toppingMenu })], items: [], optionGroups: [], now: NOW })
    for (const row of plan.createOptionGroups) expect(OptionGroupPayloadSchema.safeParse(row).success).toBe(true)
    expect(plan.createOptionGroups[0]).toMatchObject({ choices: choices.slice(0, 30) })
    expect(plan.createOptionGroups.filter((row) => row.name.toLowerCase() === 'đường')).toHaveLength(1)
    expect(plan.attach[0]!.optionGroupGids).toHaveLength(20)
    expect(plan.createOptionGroups).toHaveLength(20)
    expect(plan.createOptionGroups.at(-1)).toMatchObject({ kind: 'topping' })
    expect(plan.createItems).toHaveLength(35)
  })

  it('sortOrder nhóm lựa chọn mới nối sau nhóm đã có', () => {
    const plan = planCatalogMigration({
      groups: [group(G1, { optionGroups: [{ name: 'Đường', choices: ['Ít'] }] })],
      items: [],
      optionGroups: [{ gid: G2, sortOrder: 4 }],
      now: NOW,
    })
    expect(plan.createOptionGroups[0]?.sortOrder).toBe(5)
  })

  it('nhóm Đá trùng hằng Đá chung/Đá riêng không di trú; nhóm "Đá" chủ quán tự đặt thì có', () => {
    const plan = planCatalogMigration({
      groups: [
        group(G1, { optionGroups: [{ name: 'Đá', choices: ['Đá chung', 'Đá riêng'] }] }),
        group(G2, { optionGroups: [{ name: 'Đá', choices: ['Ít đá', 'Nhiều đá'] }] }),
      ],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.attach.map((entry) => entry.groupGid)).toEqual([G2])
    expect(plan.createOptionGroups).toEqual([expect.objectContaining({ choices: ['Ít đá', 'Nhiều đá'] })])
  })

  it('menu làm sạch xong không còn gì thì không gắn [] — nhóm giữ nguyên trạng thiếu trường', () => {
    const plan = planCatalogMigration({
      groups: [group(G1, { optionGroups: [{ name: 'Đá', choices: ['Đá chung'] }] })],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(isEmptyCatalogMigrationPlan(plan)).toBe(true)
  })

  it('nhiều món trùng tên topping: chọn theo dữ liệu (topping, đang bán, tạo sớm, gid), không theo thứ tự đọc', () => {
    const older: MigrationItem = { gid: '99999999-9999-4999-8999-999999999999', name: 'Thạch', unitPrice: 3_000, isActive: 1, createdAt: 1 }
    const newer: MigrationItem = { gid: '88888888-8888-4888-8888-888888888888', name: 'thạch', unitPrice: 3_000, isActive: 1, createdAt: 2 }
    const hidden: MigrationItem = { gid: '77777777-7777-4777-8777-777777777777', name: 'THẠCH', unitPrice: 3_000, isActive: 0, createdAt: 0 }
    const input = { groups: [group(G1, { toppingMenu: [{ name: 'Thạch', price: 3_000 }] })], optionGroups: [], now: NOW }
    for (const items of [[older, newer, hidden], [hidden, newer, older]]) {
      expect(planCatalogMigration({ ...input, items }).markToppings).toEqual([older.gid])
    }
  })

  it('một topping ghi hai lần trong cùng nhóm: giữ lần đầu', () => {
    const plan = planCatalogMigration({
      groups: [group(G1, { toppingMenu: [{ name: 'Thạch', price: 3_000 }, { name: 'thạch ', price: 9_000 }] })],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.createOptionGroups[0]).toMatchObject({ toppings: [{ price: null }] })
    expect(plan.createItems[0]).toMatchObject({ unitPrice: 3_000 })
  })

  it('topping gõ bằng chữ tổ hợp dấu vẫn khớp món dựng sẵn cùng tên', () => {
    const existing: MigrationItem = { gid: '33333333-3333-4333-8333-333333333333', name: 'Trân châu', unitPrice: 5_000, isActive: 1 }
    const plan = planCatalogMigration({
      groups: [group(G1, { toppingMenu: [{ name: 'Tra\u0302n cha\u0302u', price: 5_000 }] })],
      items: [existing],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.createItems).toEqual([])
    expect(plan.markToppings).toEqual([existing.gid])
  })

  it('tên dài cắt theo ký tự, không để nửa emoji, vẫn trong 40 đơn vị', () => {
    const plan = planCatalogMigration({
      groups: [group(G1, { optionGroups: [{ name: 'a'.repeat(39) + '🧋🧋', choices: ['Ít'] }] })],
      items: [],
      optionGroups: [],
      now: NOW,
    })
    expect(plan.createOptionGroups[0]?.name).toBe('a'.repeat(39))
  })
})
