import { env as testEnv, runInDurableObject, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CatalogEvent } from '../../shared/catalog-events'
import type { SyncEvent } from '../../shared/sync-events'
import type { Env } from '../src/env'
import { deterministicGid } from '../../shared/catalog-migration'
import { ServerEventSchema } from '../../shared/sync-events'
import { CatalogServerEventSchema, safeParseCatalogRow } from '../../shared/catalog-events'
import { LEDGER_TABLE_NAMES, safeParseLedgerRow } from '../../shared/ledger-schemas'

/** Cùng phép parse máy bản mới làm khi áp event kéo về: hỏng ở đây là mọi máy kẹt kéo. */
function clientCanApply(main: PulledEvent[], catalog: PulledEvent[]): void {
  for (const raw of main) {
    const parsed = ServerEventSchema.parse(raw)
    const localized = { ...parsed.after, ...Object.fromEntries(Object.keys(parsed.refs).map((field) => [field, null])) }
    expect(safeParseLedgerRow(parsed.table, localized).success, `${parsed.table} seq ${parsed.seq}`).toBe(true)
  }
  for (const raw of catalog) {
    const parsed = CatalogServerEventSchema.parse(raw)
    expect(safeParseCatalogRow(parsed.table, parsed.after).success).toBe(true)
  }
}

const headers = { 'content-type': 'application/json' }
const env = testEnv as unknown as Env
const NEW_CAPS = ['item-name-taken', 'catalog-v2']
const OLD_CAPS = ['item-name-taken']
let shopId: string
let token: string

type PulledEvent = {
  seq: number
  table: string
  entityKey: string
  operation: string
  after: Record<string, unknown> | null
}

const auth = (bearer = token) => ({ ...headers, authorization: `Bearer ${bearer}` })

const event = (
  table: SyncEvent['table'],
  entityKey: string,
  after: Record<string, unknown> | null,
  refs: Record<string, string | null> = {},
  operation: SyncEvent['operation'] = 'create',
  before: Record<string, unknown> | null = null,
): SyncEvent => ({
  eventId: crypto.randomUUID(),
  txId: crypto.randomUUID(),
  txOrder: 0,
  table,
  entityKey,
  entityGid: entityKey,
  operation,
  before,
  after,
  refs,
})

const catalogEvent = (
  entityKey: string,
  after: Record<string, unknown> | null,
  operation: CatalogEvent['operation'],
  before: Record<string, unknown> | null,
): CatalogEvent => ({
  eventId: crypto.randomUUID(),
  txId: crypto.randomUUID(),
  txOrder: 0,
  table: 'optionGroups',
  entityKey,
  entityGid: entityKey,
  operation,
  before,
  after,
  refs: {},
})

/** Nhóm món như bản 2.19.0 ghi: có thực đơn kiểu cũ, không có `optionGroupGids`. */
const legacyGroup = (gid: string, name = 'Trà sữa', menu: Record<string, unknown> = {}) => ({
  gid,
  name,
  sortOrder: 1,
  optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
  toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
  createdAt: 1,
  updatedAt: 1,
  ...menu,
})

/** Thực đơn 2.19.0 có hai topping: Trân châu 5.000 và Thạch 3.000. */
const milkTea = (gid: string, extra: Record<string, unknown> = {}) =>
  legacyGroup(gid, 'Trà sữa', {
    toppingMenu: [
      { name: 'Trân châu', price: 5_000 },
      { name: 'Thạch', price: 3_000 },
    ],
    ...extra,
  })

const itemRow = (gid: string, extra: Record<string, unknown> = {}) => ({
  gid,
  name: 'Trà sữa trân châu',
  unit: 'ly',
  unitPrice: 25_000,
  costPrice: null,
  isActive: 1,
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

const customerRow = (gid: string, name = 'Hoa') => ({
  gid,
  name,
  phone: '',
  address: '',
  note: '',
  createdAt: 1,
  updatedAt: 1,
})

const orderRow = (gid: string, customerGid: string, total = 50_000) => ({
  after: {
    gid,
    code: 'PBH-261011-A001',
    originalCode: '',
    customerId: 1,
    customerName: 'Hoa',
    subtotal: total,
    discount: 0,
    surcharge: 0,
    total,
    paidAmount: 0,
    status: 'unpaid',
    soldAt: 1,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  },
  refs: { customerId: customerGid },
})

const toppingGroup = (gid: string, name: string, toppings: { itemGid: string; price: number | null }[], sortOrder: number) => ({
  gid,
  name,
  kind: 'topping',
  toppings,
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
})

async function post(path: string, body: unknown, bearer = token): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { method: 'POST', headers: auth(bearer), body: JSON.stringify(body) })
}

const push = (syncEvent: SyncEvent, caps: string[], bearer = token) =>
  post(`/shop/${shopId}/events`, { epoch: 1, event: syncEvent, caps }, bearer)

const pushCatalog = (catalog: CatalogEvent, caps: string[] = NEW_CAPS, bearer = token) =>
  post(`/shop/${shopId}/catalog/events`, { epoch: 1, event: catalog, caps }, bearer)

async function pull(path: string, bearer = token): Promise<PulledEvent[]> {
  const response = await SELF.fetch(`https://example.com/shop/${shopId}/${path}`, { headers: auth(bearer) })
  expect(response.status).toBe(200)
  return (await response.json<{ events: PulledEvent[] }>()).events
}

const pullOld = (bearer = token) => pull('oplog?since=0', bearer)
const pullNew = (bearer = token) => pull('oplog?since=0&caps=catalog-v2', bearer)
const pullCatalog = (bearer = token) => pull('catalog/oplog?since=0', bearer)

/** Dòng cuối của một thực thể trong một luồng kéo về — dòng mới nhất là trạng thái sổ hiện tại. */
const latest = (rows: PulledEvent[], table: string, entityKey: string) =>
  rows.filter((row) => row.table === table && row.entityKey === entityKey).at(-1)?.after ?? undefined

async function createShop(): Promise<{ shopId: string; code: string }> {
  const created = await SELF.fetch('https://example.com/shop', {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer test-admin-secret' },
  })
  return created.json<{ shopId: string; code: string }>()
}

async function pairDevice(code: string, letter: string, localLedgerRows = 0): Promise<string> {
  const response = await SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, letter, label: `Máy ${letter}`, hasLocalLedger: localLedgerRows > 0, localLedgerRows }),
  })
  return (await response.json<{ token: string }>()).token
}

async function pairAnother(letter: string): Promise<string> {
  const code = (await (await post(`/shop/${shopId}/pair-code`, {})).json<{ code: string }>()).code
  const other = await pairDevice(code, letter)
  expect((await post(`/shop/${shopId}/seed`, { events: [] }, other)).status).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 }, other)).status).toBe(200)
  return other
}

async function catalogWarnings(): Promise<{ message: string; deviceLabel: string | null }[]> {
  const response = await SELF.fetch(`https://example.com/shop/${shopId}/devices`, { headers: auth() })
  expect(response.status).toBe(200)
  return (await response.json<{ catalogWarnings: { message: string; deviceLabel: string | null }[] }>()).catalogWarnings
}

const toppingGid = deterministicGid('topping:trân châu')
const thachGid = deterministicGid('topping:thạch')

beforeEach(async () => {
  const shop = await createShop()
  shopId = shop.shopId
  token = await pairDevice(shop.code, 'A')
  expect((await post(`/shop/${shopId}/seed`, { events: [] })).status).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
})

/** Máy cũ tạo nhóm món có thực đơn; lượt kéo đầu của máy mới sau đó di trú nó. */
async function createLegacyGroup(gid: string, data: Record<string, unknown>): Promise<void> {
  expect((await push(event('itemGroups', gid, data), OLD_CAPS)).status).toBe(201)
}

/** Máy mới đổi giá món topping: event `items` thường, không kèm trường cũ nào. */
async function repriceItem(gid: string, unitPrice: number, caps = NEW_CAPS): Promise<number> {
  const stored = latest(await pullOld(), 'items', gid)!
  const response = await push(event('items', gid, { ...stored, unitPrice, updatedAt: 9 }, { groupId: null }, 'put', stored), caps)
  return response.status
}

describe('thực đơn kiểu cũ trên Worker: chiếu và dịch sửa đổi', () => {
  it('đổi tên nhóm trên máy cũ bằng bản sao cũ: không gỡ topping, trường cũ theo phép chiếu của giá mới', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    expect(await repriceItem(toppingGid, 7_000)).toBe(201)
    const repriced = latest(await pullOld(), 'itemGroups', groupGid)
    expect(repriced).toMatchObject({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }] })
    const attached = repriced?.optionGroupGids as string[] | undefined

    const stale = milkTea(groupGid)
    expect((await push(event('itemGroups', groupGid, { ...stale, name: 'Trà sữa nóng', updatedAt: 2 }, {}, 'put', stale), OLD_CAPS)).status).toBe(201)

    const after = latest(await pullOld(), 'itemGroups', groupGid)
    expect(after).toMatchObject({
      name: 'Trà sữa nóng',
      optionGroupGids: attached,
      toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }],
    })
    const catalog = await pullCatalog()
    const toppings = catalog.find((row) => row.after?.kind === 'topping' && row.entityKey === attached?.[1])
    expect(toppings?.after).toMatchObject({ toppings: [{ itemGid: toppingGid, price: null }, { itemGid: thachGid, price: null }] })
  })

  it('sheet mở lâu: máy mới đổi giá trước, máy cũ sửa phần tử khác bằng before cũ thì giá máy mới giữ nguyên và phần tử khác được dịch', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    expect(await repriceItem(toppingGid, 7_000)).toBe(201)

    const before = milkTea(groupGid)
    const after = milkTea(groupGid, {
      toppingMenu: [
        { name: 'Trân châu', price: 5_000 },
        { name: 'Thạch', price: 4_000 },
      ],
      updatedAt: 3,
    })
    expect((await push(event('itemGroups', groupGid, after, {}, 'put', before), OLD_CAPS)).status).toBe(201)

    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({
      toppingMenu: [
        { name: 'Trân châu', price: 7_000 },
        { name: 'Thạch', price: 4_000 },
      ],
    })
  })

  it('nhóm topping dùng chung với nhóm món khác: máy cũ sửa ở G thì sao-khi-ghi, nhóm món kia không đổi', async () => {
    const g1 = crypto.randomUUID()
    const g2 = crypto.randomUUID()
    await createLegacyGroup(g1, milkTea(g1))
    await createLegacyGroup(g2, legacyGroup(g2, 'Cà phê', { toppingMenu: [{ name: 'Trân châu', price: 5_000 }] }))
    await pullNew()
    const tg1 = deterministicGid(`toppings:${g1}`)
    const storedG2 = latest(await pullOld(), 'itemGroups', g2)!
    const sharedGids = (storedG2.optionGroupGids as string[]).map((gid) => (gid === deterministicGid(`toppings:${g2}`) ? tg1 : gid))
    expect((await push(event('itemGroups', g2, { ...storedG2, optionGroupGids: sharedGids, updatedAt: 2 }, {}, 'put', storedG2), NEW_CAPS)).status).toBe(201)

    const countG2 = async () => (await pullOld()).filter((row) => row.table === 'itemGroups' && row.entityKey === g2).length
    const g2Events = await countG2()
    const before = milkTea(g1)
    const after = milkTea(g1, {
      toppingMenu: [
        { name: 'Trân châu', price: 6_000 },
        { name: 'Thạch', price: 3_000 },
      ],
      updatedAt: 3,
    })
    expect((await push(event('itemGroups', g1, after, {}, 'put', before), OLD_CAPS)).status).toBe(201)

    const g1Now = latest(await pullOld(), 'itemGroups', g1)!
    expect(g1Now.optionGroupGids as string[]).not.toContain(tg1)
    expect(g1Now).toMatchObject({ toppingMenu: [{ name: 'Trân châu', price: 6_000 }, { name: 'Thạch', price: 3_000 }] })
    const copy = (await pullCatalog()).findLast((row) => row.entityKey === (g1Now.optionGroupGids as string[])[1])
    expect(copy?.after).toMatchObject({ toppings: [{ itemGid: toppingGid, price: 6_000 }, { itemGid: thachGid, price: null }] })

    expect(latest(await pullOld(), 'itemGroups', g2)).toMatchObject({
      optionGroupGids: sharedGids,
      toppingMenu: [
        { name: 'Trân châu', price: 5_000 },
        { name: 'Thạch', price: 3_000 },
      ],
    })
    expect(await countG2()).toBe(g2Events)
    expect((await pullCatalog()).findLast((row) => row.entityKey === tg1)?.after).toMatchObject({
      toppings: [{ itemGid: toppingGid, price: null }, { itemGid: thachGid, price: null }],
    })
  })

  it('topping trùng tên ở hai nhóm topping gắn cùng nhóm món: giá chiếu theo sortOrder nhỏ hơn', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const slow = crypto.randomUUID()
    const fast = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(slow, toppingGroup(slow, 'Topping A', [{ itemGid: toppingGid, price: 4_000 }], 2), 'create', null))).status).toBe(201)
    expect((await pushCatalog(catalogEvent(fast, toppingGroup(fast, 'Topping B', [{ itemGid: toppingGid, price: 6_000 }], 1), 'create', null))).status).toBe(201)

    const stored = latest(await pullOld(), 'itemGroups', groupGid)!
    const after = { ...stored, optionGroupGids: [slow, fast], updatedAt: 5 }
    expect((await push(event('itemGroups', groupGid, after, {}, 'put', stored), NEW_CAPS)).status).toBe(201)

    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({
      optionGroupGids: [slow, fast],
      toppingMenu: [{ name: 'Trân châu', price: 6_000 }],
    })
  })

  it('lựa chọn mặc định bị bỏ thì gỡ defaultChoice; vượt giới hạn thì 201, không dịch, có cảnh báo và không 500', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const choiceGid = (await pullCatalog()).find((row) => row.after?.kind === 'choice')!.entityKey
    const storedChoice = (await pullCatalog()).findLast((row) => row.entityKey === choiceGid)!.after!
    expect(
      (await pushCatalog(catalogEvent(choiceGid, { ...storedChoice, defaultChoice: 'Không đường', updatedAt: 9 }, 'put', storedChoice))).status,
    ).toBe(201)

    const before = milkTea(groupGid)
    const trimmed = milkTea(groupGid, { optionGroups: [{ name: 'Đường', choices: ['Ít đường'] }], updatedAt: 3 })
    expect((await push(event('itemGroups', groupGid, trimmed, {}, 'put', before), OLD_CAPS)).status).toBe(201)
    expect((await pullCatalog()).findLast((row) => row.entityKey === choiceGid)?.after).toMatchObject({
      choices: ['Ít đường'],
      defaultChoice: null,
    })

    const current = latest(await pullOld(), 'itemGroups', groupGid)!
    const catalogRows = (await pullCatalog()).length
    const tooManyChoices = { ...current, optionGroups: [{ name: 'Đường', choices: Array.from({ length: 31 }, (_, i) => `Mức ${i}`) }], updatedAt: 4 }
    expect((await push(event('itemGroups', groupGid, tooManyChoices, {}, 'put', current), OLD_CAPS)).status).toBe(201)
    const tooLongName = { ...latest(await pullOld(), 'itemGroups', groupGid)!, toppingMenu: [{ name: 'a'.repeat(41), price: 1_000 }], updatedAt: 5 }
    expect(
      (await push(event('itemGroups', groupGid, tooLongName, {}, 'put', latest(await pullOld(), 'itemGroups', groupGid)!), OLD_CAPS)).status,
    ).toBe(201)

    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({
      optionGroups: [{ name: 'Đường', choices: ['Ít đường'] }],
      toppingMenu: [{ name: 'Trân châu', price: 5_000 }, { name: 'Thạch', price: 3_000 }],
    })
    expect((await pullCatalog()).length).toBe(catalogRows)
    const warnings = await catalogWarnings()
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatchObject({ message: expect.stringContaining('dài quá 40'), deviceLabel: 'Máy A' })
    expect(warnings[1]).toMatchObject({ message: expect.stringContaining('quá 30 lựa chọn'), deviceLabel: 'Máy A' })

    // Máy cũ sửa lại thực đơn đúng giới hạn: dịch được thì cảnh báo cũ của nhóm này hết nghĩa và biến khỏi màn Máy.
    const stored = latest(await pullOld(), 'itemGroups', groupGid)!
    const fixed = { ...stored, toppingMenu: [...(stored.toppingMenu as unknown[]), { name: 'Pudding', price: 7_000 }], updatedAt: 6 }
    expect((await push(event('itemGroups', groupGid, fixed, {}, 'put', stored), OLD_CAPS)).status).toBe(201)
    expect(await catalogWarnings()).toEqual([])
  })

  it('máy cũ xoá topping đang dùng thì thành no-op: món còn trong sổ, đơn có topping gửi sau đó vẫn 201', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const stored = latest(await pullOld(), 'items', toppingGid)!
    expect((await push(event('items', toppingGid, null, { groupId: null }, 'delete', stored), OLD_CAPS)).status).toBe(201)

    const rows = await pullOld()
    expect(rows.findLast((row) => row.entityKey === toppingGid)).toMatchObject({ operation: 'put', after: stored })
    expect((await pullCatalog()).findLast((row) => row.after?.kind === 'topping')?.after).toMatchObject({
      toppings: [{ itemGid: toppingGid, price: null }, { itemGid: thachGid, price: null }],
    })

    const customer = crypto.randomUUID()
    const order = crypto.randomUUID()
    const line = crypto.randomUUID()
    const orderPart = orderRow(order, customer)
    expect((await push(event('customers', customer, customerRow(customer)), OLD_CAPS)).status).toBe(201)
    expect((await push(event('orders', order, orderPart.after, orderPart.refs), OLD_CAPS)).status).toBe(201)
    const lineAfter = {
      gid: line,
      orderId: 1,
      itemId: null,
      name: 'Trà sữa',
      unit: 'ly',
      unitPrice: 25_000,
      costPrice: null,
      qty: 2,
      amount: 60_000,
      note: '',
      options: ['Ít đường'],
      toppings: [{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }],
    }
    expect((await push(event('orderLines', line, lineAfter, { orderId: order, itemId: null }), OLD_CAPS)).status).toBe(201)
    expect(latest(await pullOld(), 'orderLines', line)).toMatchObject({ toppings: [{ name: 'Trân châu', unitPrice: 5_000, qty: 2 }] })
  })

  it('máy cũ tạo món trùng tên topping ẩn: topping thành bán riêng, 409 item-name-taken; thử lại không kích hoạt thêm', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const sameName = crypto.randomUUID()
    const attempt = () => push(event('items', sameName, itemRow(sameName, { name: 'Trân châu' }), { groupId: null }), OLD_CAPS)

    const first = await attempt()
    expect(first.status).toBe(409)
    await expect(first.json()).resolves.toMatchObject({ error: 'item-name-taken', existingGid: toppingGid, existingName: 'Trân châu' })
    const history = (await pullOld()).filter((row) => row.entityKey === toppingGid)
    expect(history.map((row) => [row.operation, (row.after as { isActive: number }).isActive])).toEqual([
      ['create', 0],
      ['put', 1],
    ])
    expect(history.at(-1)?.after).toMatchObject({ kind: 'topping', isActive: 1 })

    const second = await attempt()
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({ error: 'item-name-taken', existingGid: toppingGid })
    expect((await pullOld()).filter((row) => row.entityKey === toppingGid)).toHaveLength(2)
  })

  it('máy mới (catalog-v2) đổi tên nhóm bằng bản sao cũ: trường cũ vẫn khớp phép chiếu, optionGroupGids giữ nguyên', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    expect(await repriceItem(toppingGid, 7_000)).toBe(201)
    const stored = latest(await pullOld(), 'itemGroups', groupGid)!

    const staleBefore = milkTea(groupGid, { optionGroupGids: stored.optionGroupGids })
    const staleAfter = { ...staleBefore, name: 'Trà sữa nóng', updatedAt: 6 }
    expect((await push(event('itemGroups', groupGid, staleAfter, {}, 'put', staleBefore), NEW_CAPS)).status).toBe(201)

    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({
      name: 'Trà sữa nóng',
      optionGroupGids: stored.optionGroupGids,
      toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }],
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
    })
  })

  it('chưa máy bản mới nào gửi catalog-v2, máy cũ sửa menu: di trú chạy inline, menu đủ cả phần chưa sửa', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))

    const before = milkTea(groupGid)
    const after = milkTea(groupGid, {
      toppingMenu: [
        { name: 'Trân châu', price: 5_000 },
        { name: 'Thạch', price: 4_000 },
      ],
      updatedAt: 2,
    })
    expect((await push(event('itemGroups', groupGid, after, {}, 'put', before), OLD_CAPS)).status).toBe(201)

    const main = await pullOld()
    expect(latest(main, 'itemGroups', groupGid)).toMatchObject({
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
      toppingMenu: [
        { name: 'Trân châu', price: 5_000 },
        { name: 'Thạch', price: 4_000 },
      ],
    })
    expect(latest(main, 'items', toppingGid)).toMatchObject({ kind: 'topping', isActive: 0 })
    expect(latest(main, 'items', thachGid)).toMatchObject({ kind: 'topping', isActive: 0 })
    const catalog = await pullCatalog()
    expect(catalog.map((row) => row.after?.kind)).toEqual(['choice', 'topping', 'topping'])
    expect(catalog.findLast((row) => row.after?.kind === 'topping')?.after).toMatchObject({
      toppings: [
        { itemGid: toppingGid, price: null },
        { itemGid: thachGid, price: 4_000 },
      ],
    })
    clientCanApply(await pullNew(), catalog)
  })

  it('máy mới đổi giá món topping sinh một event itemGroups với toppingMenu giá mới; lặp lại không sinh event thừa', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const count = async () => (await pullOld()).filter((row) => row.table === 'itemGroups' && row.entityKey === groupGid).length
    const start = await count()

    expect(await repriceItem(toppingGid, 7_000)).toBe(201)
    expect(await count()).toBe(start + 1)
    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({ toppingMenu: [{ name: 'Trân châu', price: 7_000 }, { name: 'Thạch', price: 3_000 }] })

    expect(await repriceItem(toppingGid, 7_000)).toBe(201)
    expect(await count()).toBe(start + 1)
  })

  it('event luồng danh mục đổi giá riêng hoặc tắt nhóm đều được chiếu lại; chiếu lặp không thêm event', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const tg = deterministicGid(`toppings:${groupGid}`)
    const count = async () => (await pullOld()).filter((row) => row.table === 'itemGroups' && row.entityKey === groupGid).length
    const start = await count()

    const storedTg = (await pullCatalog()).findLast((row) => row.entityKey === tg)!.after!
    const repriced = { ...storedTg, toppings: [{ itemGid: toppingGid, price: 6_000 }, { itemGid: thachGid, price: null }], updatedAt: 7 }
    expect((await pushCatalog(catalogEvent(tg, repriced, 'put', storedTg))).status).toBe(201)
    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({ toppingMenu: [{ name: 'Trân châu', price: 6_000 }, { name: 'Thạch', price: 3_000 }] })
    expect(await count()).toBe(start + 1)

    const again = { ...repriced, updatedAt: 8 }
    expect((await pushCatalog(catalogEvent(tg, again, 'put', repriced))).status).toBe(201)
    expect(await count()).toBe(start + 1)

    const disabled = { ...again, isActive: 0, updatedAt: 9 }
    expect((await pushCatalog(catalogEvent(tg, disabled, 'put', again))).status).toBe(201)
    expect(latest(await pullOld(), 'itemGroups', groupGid)).toMatchObject({
      optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
      toppingMenu: [],
    })

    const main = await pullOld()
    expect(new Set(main.map((row) => row.table)).size).toBeGreaterThan(0)
    for (const table of new Set(main.map((row) => row.table))) expect(LEDGER_TABLE_NAMES).toContain(table)
    clientCanApply(await pullNew(), await pullCatalog())
  })

  it('máy bản mới thứ hai kéo lại sau di trú không sinh trùng nhóm lựa chọn hay món topping', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    const other = await pairAnother('B')
    const mainBefore = (await pullNew()).length
    const catalogBefore = (await pullCatalog()).length
    expect((await pullNew(other)).length).toBe(mainBefore)
    expect((await pullCatalog(other)).length).toBe(catalogBefore)
  })
  it('lượt ghép bỏ dở để lại admission đã hết hạn: máy mới kéo caps catalog-v2 vẫn di trú ngay, không chờ lượt đẩy kế tiếp', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    // Lượt ghép bỏ dở không có đường nào tới đây ngoài việc để lại dòng này: ghi thẳng vào kho DO với hạn đã qua.
    await runInDurableObject(env.SHOP_DO.get(env.SHOP_DO.idFromName(shopId)), (_instance, state) => {
      state.storage.sql.exec(
        'INSERT INTO ledgerAdmission (singleton, deviceId, codeHash, expectedRows, expiresAt) VALUES (1, ?, ?, ?, ?)',
        'abandoned-device',
        'abandoned-code',
        1,
        Date.now() - 1,
      )
    })

    const migrated = await pullNew()
    expect(latest(migrated, 'items', toppingGid)).toMatchObject({ kind: 'topping', isActive: 0 })
    expect((latest(migrated, 'itemGroups', groupGid)?.optionGroupGids as string[]).length).toBe(2)
    expect((await pullCatalog()).map((row) => row.after?.kind)).toEqual(['choice', 'topping'])
  })

  it('máy cũ xoá món chỉ nằm trong nhóm topping đang tắt thì thành no-op: món còn trong sổ, nhóm tắt không có itemGid treo', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const tg = deterministicGid(`toppings:${groupGid}`)
    const storedTg = (await pullCatalog()).findLast((row) => row.entityKey === tg)!.after!
    expect((await pushCatalog(catalogEvent(tg, { ...storedTg, isActive: 0, updatedAt: 9 }, 'put', storedTg))).status).toBe(201)

    const stored = latest(await pullOld(), 'items', toppingGid)!
    expect((await push(event('items', toppingGid, null, { groupId: null }, 'delete', stored), OLD_CAPS)).status).toBe(201)
    const last = (await pullOld()).findLast((row) => row.entityKey === toppingGid)!
    expect(last).toMatchObject({ operation: 'put', after: stored })
    expect((await pullCatalog()).findLast((row) => row.entityKey === tg)?.after).toMatchObject({
      isActive: 0,
      toppings: expect.arrayContaining([{ itemGid: toppingGid, price: null }]),
    })
  })

  it('máy catalog-v2 xoá món chỉ nằm trong nhóm topping đang tắt: vẫn 201 và món bị xoá khỏi sổ', async () => {
    const groupGid = crypto.randomUUID()
    await createLegacyGroup(groupGid, milkTea(groupGid))
    await pullNew()
    const tg = deterministicGid(`toppings:${groupGid}`)
    const storedTg = (await pullCatalog()).findLast((row) => row.entityKey === tg)!.after!
    expect((await pushCatalog(catalogEvent(tg, { ...storedTg, isActive: 0, updatedAt: 9 }, 'put', storedTg))).status).toBe(201)

    const stored = latest(await pullOld(), 'items', toppingGid)!
    expect((await push(event('items', toppingGid, null, { groupId: null }, 'delete', stored), NEW_CAPS)).status).toBe(201)
    expect((await pullOld()).findLast((row) => row.entityKey === toppingGid)).toMatchObject({ operation: 'delete' })
  })
})
