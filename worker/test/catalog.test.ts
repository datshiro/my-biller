import { env as testEnv, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminDataPage } from '../../shared/admin-contract'
import type { CatalogEvent } from '../../shared/catalog-events'
import type { SyncEvent } from '../../shared/sync-events'
import type { Env } from '../src/env'

const env = testEnv as unknown as Env
const headers = { 'content-type': 'application/json' }
const NEW_CAPS = ['item-name-taken', 'catalog-v2']
let shopId: string
let token: string

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
  operation: CatalogEvent['operation'] = 'create',
  before: Record<string, unknown> | null = null,
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

const itemRow = (gid: string, extra: Record<string, unknown> = {}) => ({
  gid,
  name: `Món ${gid.slice(0, 4)}`,
  unit: 'ly',
  unitPrice: 5_000,
  costPrice: null,
  isActive: 1,
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})

const groupBase = (gid: string, name: string) => ({
  gid,
  name,
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder: 0,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
})

const choiceGroup = (gid: string, name = 'Đường') => ({ ...groupBase(gid, name), kind: 'choice', choices: ['Ít', 'Vừa'] })

const toppingGroup = (gid: string, itemGids: string[], extra: Record<string, unknown> = {}) => ({
  ...groupBase(gid, 'Topping'),
  kind: 'topping',
  toppings: itemGids.map((itemGid) => ({ itemGid, price: null })),
  ...extra,
})

async function post(path: string, body: unknown, bearer = token): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { method: 'POST', headers: auth(bearer), body: JSON.stringify(body) })
}

const push = (syncEvent: SyncEvent, caps: string[] = NEW_CAPS) => post(`/shop/${shopId}/events`, { epoch: 1, event: syncEvent, caps })
const pushCatalog = (catalog: CatalogEvent, epoch = 1) =>
  post(`/shop/${shopId}/catalog/events`, { epoch, event: catalog, caps: NEW_CAPS })

async function pull(path: 'oplog' | 'catalog/oplog', since = 0) {
  const response = await SELF.fetch(`https://example.com/shop/${shopId}/${path}?since=${since}`, { headers: auth() })
  expect(response.status).toBe(200)
  return response.json<{ events: Array<{ seq: number; table: string; entityKey: string; operation: string }>; hasMore: boolean }>()
}

async function createShop(): Promise<{ shopId: string; code: string }> {
  const created = await SELF.fetch('https://example.com/shop', {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer test-admin-secret' },
  })
  return created.json<{ shopId: string; code: string }>()
}

async function pair(code: string, letter: string, localLedgerRows: number) {
  return SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, letter, label: `Máy ${letter}`, hasLocalLedger: localLedgerRows > 0, localLedgerRows }),
  })
}

async function pairCode(): Promise<string> {
  const response = await post(`/shop/${shopId}/pair-code`, {})
  return (await response.json<{ code: string }>()).code
}

beforeEach(async () => {
  const shop = await createShop()
  shopId = shop.shopId
  const device = await (await pair(shop.code, 'A', 0)).json<{ token: string }>()
  token = device.token
  expect((await post(`/shop/${shopId}/seed`, { events: [] })).status).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
})

describe('luồng danh mục', () => {
  it('có seq riêng liền mạch, sổ chính không có event optionGroups', async () => {
    const itemGid = crypto.randomUUID()
    expect((await push(event('items', itemGid, itemRow(itemGid), { groupId: null }))).status).toBe(201)
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const created = await pushCatalog(catalogEvent(first, choiceGroup(first)))
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ seq: 1, duplicate: false })
    expect((await pushCatalog(catalogEvent(second, choiceGroup(second, 'Đá')))).status).toBe(201)

    const catalog = await pull('catalog/oplog')
    expect(catalog.events.map((row) => row.seq)).toEqual([1, 2])
    expect(catalog.events.map((row) => row.entityKey)).toEqual([first, second])
    expect((await pull('catalog/oplog', 1)).events.map((row) => row.seq)).toEqual([2])

    const ledger = await pull('oplog')
    expect(ledger.events.map((row) => row.seq)).toEqual([1])
    expect(ledger.events.some((row) => row.table === 'optionGroups')).toBe(false)
  })

  it('sổ chính từ chối event optionGroups như mọi bảng lạ', async () => {
    const gid = crypto.randomUUID()
    const smuggled = { ...catalogEvent(gid, choiceGroup(gid)), refs: {} }
    expect((await post(`/shop/${shopId}/events`, { epoch: 1, event: smuggled, caps: NEW_CAPS })).status).toBe(400)
    expect((await pull('oplog')).events).toHaveLength(0)
  })

  it('chống gửi trùng bằng eventId và fence epoch cũ', async () => {
    const gid = crypto.randomUUID()
    const created = catalogEvent(gid, choiceGroup(gid))
    expect((await pushCatalog(created)).status).toBe(201)
    const duplicate = await pushCatalog(created)
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ seq: 1, duplicate: true })

    expect((await post(`/shop/${shopId}/epoch`, { epoch: 2 })).status).toBe(200)
    const other = crypto.randomUUID()
    const stale = await pushCatalog(catalogEvent(other, choiceGroup(other)), 1)
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toMatchObject({ error: 'stale-leader' })
    expect((await pull('catalog/oplog')).events).toHaveLength(1)
  })

  it('từ chối payload sai hợp đồng và gid không khớp', async () => {
    const gid = crypto.randomUUID()
    const invalid = await pushCatalog(catalogEvent(gid, { ...choiceGroup(gid), choices: [] }))
    expect(invalid.status).toBe(409)
    await expect(invalid.json()).resolves.toMatchObject({ error: 'business-rejected' })
    const mismatch = await pushCatalog(catalogEvent(gid, choiceGroup(crypto.randomUUID())))
    expect(mismatch.status).toBe(409)
    expect((await pull('catalog/oplog')).events).toHaveLength(0)
  })

  it('máy chưa xác thực không đẩy, không kéo được', async () => {
    const gid = crypto.randomUUID()
    expect((await post(`/shop/${shopId}/catalog/events`, { epoch: 1, event: catalogEvent(gid, choiceGroup(gid)) }, 'x'.repeat(43))).status).toBe(401)
    const pulled = await SELF.fetch(`https://example.com/shop/${shopId}/catalog/oplog?since=0`)
    expect(pulled.status).toBe(401)
  })
})

describe('tham chiếu gid giữa hai luồng', () => {
  it('nhóm topping đang bật chỉ nhận món topping có trong sổ chung; nhóm tắt thì không kiểm', async () => {
    const topping = crypto.randomUUID()
    const plain = crypto.randomUUID()
    expect((await push(event('items', topping, itemRow(topping, { kind: 'topping', isActive: 0 }), { groupId: null }))).status).toBe(201)
    expect((await push(event('items', plain, itemRow(plain), { groupId: null }))).status).toBe(201)

    const missing = crypto.randomUUID()
    const rejectedMissing = await pushCatalog(catalogEvent(missing, toppingGroup(missing, [crypto.randomUUID()])))
    expect(rejectedMissing.status).toBe(409)
    const rejectedPlain = await pushCatalog(catalogEvent(missing, toppingGroup(missing, [plain])))
    expect(rejectedPlain.status).toBe(409)
    await expect(rejectedPlain.json()).resolves.toMatchObject({ error: 'business-rejected' })

    const ok = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(ok, toppingGroup(ok, [topping])))).status).toBe(201)
    const inactive = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(inactive, toppingGroup(inactive, [crypto.randomUUID()], { isActive: 0 })))).status).toBe(201)
  })

  it('sửa nhóm không bị từ chối vì phần tử đã có từ trước, chỉ phần tử mới bị kiểm', async () => {
    const topping = crypto.randomUUID()
    expect((await push(event('items', topping, itemRow(topping, { kind: 'topping' }), { groupId: null }))).status).toBe(201)
    const gid = crypto.randomUUID()
    const group = toppingGroup(gid, [topping])
    expect((await pushCatalog(catalogEvent(gid, group))).status).toBe(201)
    // Máy cũ xoá món topping (không bị chặn); nhóm còn trỏ món đã xoá — đọc thì ẩn.
    expect((await push(event('items', topping, null, { groupId: null }, 'delete', itemRow(topping, { kind: 'topping' })), ['item-name-taken'])).status).toBe(201)

    const renamed = { ...group, name: 'Topping mới', updatedAt: 2 }
    expect((await pushCatalog(catalogEvent(gid, renamed, 'put', group))).status).toBe(201)
    const added = { ...renamed, toppings: [...renamed.toppings, { itemGid: crypto.randomUUID(), price: null }], updatedAt: 3 }
    expect((await pushCatalog(catalogEvent(gid, added, 'put', renamed))).status).toBe(409)
  })

  it('optionGroupGids mới phải có trong luồng danh mục — chỉ với máy catalog-v2', async () => {
    const group = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(group, choiceGroup(group)))).status).toBe(201)

    const good = crypto.randomUUID()
    expect((await push(event('items', good, itemRow(good, { optionGroupGids: [group] }), { groupId: null }))).status).toBe(201)

    const dangling = crypto.randomUUID()
    const rejected = await push(event('items', dangling, itemRow(dangling, { optionGroupGids: [crypto.randomUUID()] }), { groupId: null }))
    expect(rejected.status).toBe(409)
    await expect(rejected.json()).resolves.toMatchObject({ error: 'business-rejected' })

    const itemGroup = crypto.randomUUID()
    const groupRow = { gid: itemGroup, name: 'Nước', sortOrder: 1, createdAt: 1, updatedAt: 1, optionGroupGids: [crypto.randomUUID()] }
    expect((await push(event('itemGroups', itemGroup, groupRow))).status).toBe(409)
    expect((await push(event('itemGroups', itemGroup, groupRow), ['item-name-taken'])).status).toBe(201)
  })

  it('máy cũ sửa món đã gắn nhóm vừa bị xoá vẫn được nhận', async () => {
    const group = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(group, choiceGroup(group)))).status).toBe(201)
    const item = crypto.randomUUID()
    const stored = itemRow(item, { optionGroupGids: [group] })
    expect((await push(event('items', item, stored, { groupId: null }))).status).toBe(201)
    expect((await pushCatalog(catalogEvent(group, null, 'delete', choiceGroup(group)))).status).toBe(201)

    const legacy = { ...itemRow(item), unitPrice: 7_000, updatedAt: 2 }
    expect((await push(event('items', item, legacy, { groupId: null }, 'put', itemRow(item)), ['item-name-taken'])).status).toBe(201)
    const newer = { ...stored, unitPrice: 8_000, updatedAt: 3 }
    expect((await push(event('items', item, newer, { groupId: null }, 'put', stored))).status).toBe(201)
  })

  it('xoá món đang thuộc nhóm topping bật: chặn máy catalog-v2, máy cũ vẫn được nhận', async () => {
    const used = crypto.randomUUID()
    const free = crypto.randomUUID()
    for (const gid of [used, free]) {
      expect((await push(event('items', gid, itemRow(gid, { kind: 'topping' }), { groupId: null }))).status).toBe(201)
    }
    const active = crypto.randomUUID()
    const inactive = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(active, toppingGroup(active, [used])))).status).toBe(201)
    expect((await pushCatalog(catalogEvent(inactive, toppingGroup(inactive, [free], { isActive: 0 })))).status).toBe(201)

    const deleteOf = (gid: string) => event('items', gid, null, { groupId: null }, 'delete', itemRow(gid, { kind: 'topping' }))
    const blocked = await push(deleteOf(used))
    expect(blocked.status).toBe(409)
    await expect(blocked.json()).resolves.toMatchObject({ error: 'business-rejected', message: expect.stringContaining('Topping') })
    expect((await push(deleteOf(free))).status).toBe(201)
    expect((await push(deleteOf(used), ['item-name-taken'])).status).toBe(201)
  })
})

describe('ghép máy với luồng danh mục', () => {
  it('máy đầu tiên nạp sổ nạp luôn nhóm lựa chọn; máy ghép sau kéo cả hai luồng từ 0', async () => {
    const shop = await createShop()
    shopId = shop.shopId
    const first = await (await pair(shop.code, 'A', 3)).json<{ token: string }>()
    token = first.token
    const topping = crypto.randomUUID()
    const groupGid = crypto.randomUUID()
    const choice = crypto.randomUUID()
    const seeded = await post(`/shop/${shopId}/seed`, {
      events: [
        event('items', topping, itemRow(topping, { kind: 'topping', optionGroupGids: [choice] }), { groupId: null }),
        catalogEvent(groupGid, toppingGroup(groupGid, [topping])),
        catalogEvent(choice, choiceGroup(choice)),
      ],
    })
    expect(seeded.status).toBe(201)
    await expect(seeded.json()).resolves.toMatchObject({ activated: true, lastSeq: 1 })

    const second = await (await pair(await pairCode(), 'B', 0)).json<{ token: string }>()
    token = second.token
    expect((await post(`/shop/${shopId}/seed`, { events: [] })).status).toBe(201)
    expect((await pull('oplog')).events.map((row) => row.table)).toEqual(['items'])
    expect((await pull('catalog/oplog')).events.map((row) => [row.seq, row.entityKey])).toEqual([
      [1, groupGid],
      [2, choice],
    ])
  })

  it('ảnh sổ đếm cả dòng danh mục: thiếu thì chưa kích hoạt', async () => {
    const shop = await createShop()
    shopId = shop.shopId
    token = (await (await pair(shop.code, 'A', 2)).json<{ token: string }>()).token
    const choice = crypto.randomUUID()
    const incomplete = await post(`/shop/${shopId}/seed`, { events: [catalogEvent(choice, choiceGroup(choice))] })
    expect(incomplete.status).toBe(409)
    await expect(incomplete.json()).resolves.toMatchObject({ error: 'seed-incomplete' })
  })

  it('sổ chung chỉ có nhóm lựa chọn vẫn tính là đã có dữ liệu khi máy có sổ cục bộ ghép vào', async () => {
    const choice = crypto.randomUUID()
    expect((await pushCatalog(catalogEvent(choice, choiceGroup(choice)))).status).toBe(201)
    const response = await pair(await pairCode(), 'B', 4)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'merge-required' })
  })
})

describe('admin đọc bảng danh mục', () => {
  it('table=optionGroups đọc catalogLedger, phân trang theo seq danh mục', async () => {
    const gids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const gid of gids) expect((await pushCatalog(catalogEvent(gid, choiceGroup(gid)))).status).toBe(201)
    const stub = env.SHOP_DO.get(env.SHOP_DO.idFromName(shopId))
    const read = async (after: number) =>
      (await stub.fetch(`https://shop.internal/internal/admin/data?table=optionGroups&after=${after}&limit=2`)).json<AdminDataPage>()
    const first = await read(0)
    expect(first.rows.map((row) => row.entityKey)).toEqual(gids.slice(0, 2))
    expect(first.rows[0]).toMatchObject({ updatedSeq: 1, after: { gid: gids[0], kind: 'choice' } })
    expect(first.next).toBe(2)
    const second = await read(first.next ?? 0)
    expect(second.rows.map((row) => row.entityKey)).toEqual([gids[2]])
    expect(second.next).toBeNull()
  })
})
