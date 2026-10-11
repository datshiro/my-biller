import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CatalogEvent } from '../../shared/catalog-events'
import type { SyncEvent } from '../../shared/sync-events'
import { deterministicGid } from '../../shared/catalog-migration'
import { ServerEventSchema } from '../../shared/sync-events'
import { CatalogServerEventSchema, safeParseCatalogRow } from '../../shared/catalog-events'
import { safeParseLedgerRow } from '../../shared/ledger-schemas'

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

const catalogEvent = (entityKey: string, after: Record<string, unknown> | null, operation: CatalogEvent['operation'], before: Record<string, unknown> | null): CatalogEvent => ({
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

async function post(path: string, body: unknown, bearer = token): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { method: 'POST', headers: auth(bearer), body: JSON.stringify(body) })
}

const push = (syncEvent: SyncEvent, caps: string[], bearer = token) =>
  post(`/shop/${shopId}/events`, { epoch: 1, event: syncEvent, caps }, bearer)

async function pull(path: string, bearer = token): Promise<PulledEvent[]> {
  const response = await SELF.fetch(`https://example.com/shop/${shopId}/${path}`, { headers: auth(bearer) })
  expect(response.status).toBe(200)
  return (await response.json<{ events: PulledEvent[] }>()).events
}

const pullOld = (bearer = token) => pull('oplog?since=0', bearer)
const pullNew = (bearer = token) => pull('oplog?since=0&caps=catalog-v2', bearer)
const pullCatalog = (bearer = token) => pull('catalog/oplog?since=0', bearer)

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

const toppingGid = deterministicGid('topping:trân châu')

beforeEach(async () => {
  const shop = await createShop()
  shopId = shop.shopId
  token = await pairDevice(shop.code, 'A')
  expect((await post(`/shop/${shopId}/seed`, { events: [] })).status).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
})

describe('di trú menu cũ trên Worker', () => {
  it('chưa máy bản mới nào chạm sổ thì không di trú; lượt kéo đầu của máy bản mới di trú một lần', async () => {
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    expect((await pullOld()).map((row) => row.table)).toEqual(['itemGroups'])

    const pulled = await pullNew()
    expect(pulled.map((row) => [row.table, row.operation])).toEqual([
      ['itemGroups', 'create'],
      ['items', 'create'],
      ['itemGroups', 'put'],
    ])
    expect(pulled[1]).toMatchObject({ entityKey: toppingGid, after: { name: 'Trân châu', unitPrice: 5_000, isActive: 0, kind: 'topping' } })
    const catalog = await pullCatalog()
    expect(catalog.map((row) => row.after?.kind)).toEqual(['choice', 'topping'])
    expect(catalog[1]?.after).toMatchObject({ toppings: [{ itemGid: toppingGid, price: null }] })
    expect(pulled[2]?.after).toMatchObject({
      optionGroupGids: catalog.map((row) => row.entityKey),
      // Trường cũ giữ nguyên cho máy bản cũ.
      toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
    })

    clientCanApply(pulled, catalog)

    // Máy bản mới thứ hai chạm sổ: không sinh trùng.
    const other = await pairAnother('B')
    expect(await pullNew(other)).toHaveLength(3)
    expect(await pullCatalog(other)).toHaveLength(2)
  })

  it('đẩy event có cap catalog-v2 hay chạm luồng danh mục cũng kích hoạt di trú', async () => {
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    expect(await pullCatalog()).toHaveLength(2)
    const itemGid = crypto.randomUUID()
    expect((await push(event('items', itemGid, itemRow(itemGid), { groupId: null }), NEW_CAPS)).status).toBe(201)
    expect((await pullOld()).filter((row) => row.table === 'items')).toHaveLength(2)
  })

  it('món đang bán trùng tên topping chỉ thành món topping, vẫn đang bán và giữ giá', async () => {
    const existing = crypto.randomUUID()
    expect((await push(event('items', existing, itemRow(existing, { name: 'trân châu', unitPrice: 6_000 }), { groupId: null }), OLD_CAPS)).status).toBe(201)
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)

    const pulled = await pullNew()
    const put = pulled.find((row) => row.table === 'items' && row.operation === 'put')
    expect(put).toMatchObject({ entityKey: existing, after: { kind: 'topping', isActive: 1, unitPrice: 6_000 } })
    expect(pulled.some((row) => row.table === 'items' && row.operation === 'create' && row.entityKey !== existing)).toBe(false)
    expect((await pullCatalog())[1]?.after).toMatchObject({ toppings: [{ itemGid: existing, price: 5_000 }] })
  })

  it('sau mốc: máy cũ tạo nhóm có menu thì di trú ngay; máy cũ đổi tên nhóm đã di trú thì không đụng, gid nhóm lựa chọn được giữ', async () => {
    expect(await pullNew()).toHaveLength(0)
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    const migrated = await pullOld()
    expect(migrated).toHaveLength(3)
    const attached = migrated[2]?.after?.optionGroupGids

    const renamed = { ...legacyGroup(groupGid, 'Trà sữa nóng'), updatedAt: 2 }
    expect((await push(event('itemGroups', groupGid, renamed, {}, 'put', legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    const after = await pullOld()
    expect(after).toHaveLength(4)
    expect(after[3]?.after).toMatchObject({ name: 'Trà sữa nóng', optionGroupGids: attached })
    expect(await pullCatalog()).toHaveLength(2)
  })

  it('sửa đổi sau di trú không bị lần chạy sau ghi đè', async () => {
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    await pullNew()
    const [choice, topping] = await pullCatalog()
    const toppingAfter = { ...topping!.after!, name: 'Topping riêng', updatedAt: 9 }
    expect(
      (await post(`/shop/${shopId}/catalog/events`, { epoch: 1, event: catalogEvent(topping!.entityKey, toppingAfter, 'put', topping!.after), caps: NEW_CAPS }))
        .status,
    ).toBe(201)
    const detached = { ...legacyGroup(groupGid), optionGroupGids: [choice!.entityKey], updatedAt: 9 }
    expect((await push(event('itemGroups', groupGid, detached, {}, 'put', legacyGroup(groupGid)), NEW_CAPS)).status).toBe(201)

    // Một nhóm cũ khác tới làm di trú chạy lại trên toàn sổ.
    const otherGroup = crypto.randomUUID()
    expect((await push(event('itemGroups', otherGroup, legacyGroup(otherGroup, 'Cà phê')), OLD_CAPS)).status).toBe(201)
    const groups = (await pullOld()).filter((row) => row.table === 'itemGroups' && row.entityKey === groupGid)
    expect(groups.at(-1)?.after).toMatchObject({ optionGroupGids: [choice!.entityKey] })
    const catalog = await pullCatalog()
    expect(catalog.filter((row) => row.entityKey === topping!.entityKey).at(-1)?.after).toMatchObject({ name: 'Topping riêng' })
    // Nhóm "Cà phê" dùng lại đúng món topping đã có.
    expect(catalog.at(-1)?.after).toMatchObject({ name: 'Topping Cà phê', toppings: [{ itemGid: toppingGid, price: null }] })
  })

  it('máy cũ nạp sổ có menu cũ vào quán đã di trú: di trú ngay sau nạp sổ', async () => {
    const shop = await createShop()
    shopId = shop.shopId
    token = await pairDevice(shop.code, 'A')
    expect((await post(`/shop/${shopId}/seed`, { events: [] })).status).toBe(201)
    expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
    expect(await pullNew()).toHaveLength(0)

    // Sổ chung trống nên máy cũ có sổ cục bộ vẫn ghép làm người nạp sổ.
    const code = (await (await post(`/shop/${shopId}/pair-code`, {})).json<{ code: string }>()).code
    const oldDevice = await pairDevice(code, 'B', 1)
    const groupGid = crypto.randomUUID()
    const seeded = await post(`/shop/${shopId}/seed`, { events: [event('itemGroups', groupGid, legacyGroup(groupGid))] }, oldDevice)
    expect(seeded.status).toBe(201)
    await expect(seeded.json()).resolves.toMatchObject({ lastSeq: 1 })
    expect((await pullOld(oldDevice)).map((row) => row.operation)).toEqual(['create', 'create', 'put'])
  })

  it('event của máy cũ không bị từ chối khi di trú đã chạy (xoá món topping, tạo món trùng tên topping ẩn)', async () => {
    const groupGid = crypto.randomUUID()
    expect((await push(event('itemGroups', groupGid, legacyGroup(groupGid)), OLD_CAPS)).status).toBe(201)
    await pullNew()
    const sameName = crypto.randomUUID()
    // Máy cũ không thấy topping chỉ bán kèm: Worker bật nó thành bán riêng rồi để luật trùng tên hiện hành nối món mới.
    const created = await push(event('items', sameName, itemRow(sameName, { name: 'Trân châu' }), { groupId: null }), OLD_CAPS)
    expect(created.status).toBe(409)
    await expect(created.json()).resolves.toMatchObject({ error: 'item-name-taken', existingGid: toppingGid })
    const topping = (await pullOld()).findLast((row) => row.entityKey === toppingGid)!.after!
    expect(topping).toMatchObject({ isActive: 1, kind: 'topping' })
    // Món đang nằm trong nhóm topping: lần xoá của máy cũ thành ghi lại bản đang lưu, không bị từ chối.
    expect((await push(event('items', toppingGid, null, { groupId: null }, 'delete', topping), OLD_CAPS)).status).toBe(201)
    const last = (await pullOld()).findLast((row) => row.entityKey === toppingGid)!
    expect(last).toMatchObject({ operation: 'put', after: topping })
  })
})
