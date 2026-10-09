import { env as testEnv, runInDurableObject, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminDataPage, ShopDetail, ShopOverview } from '../../shared/admin-contract'
import { summarizeServerLedger } from '../../shared/ledger-money'
import type { SyncEvent } from '../../shared/sync-events'
import type { Env } from '../src/env'

const env = testEnv as unknown as Env

const headers = { 'content-type': 'application/json' }
let shopId: string
let token: string
let deviceId: string

type Activity = { deviceId: string; lastSeenAt: number; pulledSeq: number; rewoundAt: number | null }
type IdentityBody = { shopId: string; createdAt: number }

const auth = () => ({ ...headers, authorization: `Bearer ${token}` })

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
  entityGid: table === 'settings' ? null : entityKey,
  operation,
  before,
  after,
  refs,
})

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify(body),
  })
}

async function push(syncEvent: SyncEvent, epoch = 1): Promise<Response> {
  return post(`/shop/${shopId}/events`, { epoch, event: syncEvent, deviceId: crypto.randomUUID(), caps: [] })
}

const accepted = async (response: Promise<Response>) => expect((await response).status).toBe(201)

async function pushCustomers(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const gid = crypto.randomUUID()
    await accepted(push(event('customers', gid, customerRow(gid))))
  }
}

const oplog = (since: number, bearer = token) =>
  SELF.fetch(`https://example.com/shop/${shopId}/oplog?since=${since}`, {
    headers: { authorization: `Bearer ${bearer}` },
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

const orderRow = (
  gid: string,
  customerGid: string,
  { total, soldAt, code }: { total: number; soldAt: number; code: string },
) => ({
  after: {
    gid,
    code,
    originalCode: '',
    customerId: 1,
    customerName: 'Hoa',
    subtotal: total,
    discount: 0,
    surcharge: 0,
    total,
    paidAmount: 0,
    status: 'unpaid',
    soldAt,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  },
  refs: { customerId: customerGid },
})

const paymentRow = (gid: string, amount: number) => ({
  gid,
  orderId: 1,
  allocatedOrderId: 0,
  customerId: 1,
  amount,
  method: 'cash',
  paidAt: 1,
  note: '',
})

const lineRow = (gid: string) => ({
  gid,
  orderId: 1,
  itemId: null,
  name: 'Trà',
  unit: 'ly',
  unitPrice: 25_000,
  costPrice: null,
  qty: 1,
  amount: 25_000,
  note: '',
  options: [],
  toppings: [],
})

const lineRefs = (orderGid: string) => ({ orderId: orderGid, itemId: null })

const shopStub = (id: string) => env.SHOP_DO.get(env.SHOP_DO.idFromName(id))

async function withSql<T>(read: (sql: SqlStorage) => T, target = shopId): Promise<T> {
  return runInDurableObject(shopStub(target), (_instance, state) => read(state.storage.sql))
}

async function activityOf(target = deviceId): Promise<Activity | null> {
  return withSql(
    (sql) =>
      [
        ...sql.exec<Activity>(
          'SELECT deviceId, lastSeenAt, pulledSeq, rewoundAt FROM deviceActivity WHERE deviceId = ?',
          target,
        ),
      ][0] ?? null,
  )
}

async function rewindClock(target = deviceId): Promise<void> {
  await withSql((sql) => {
    sql.exec('UPDATE deviceActivity SET lastSeenAt = lastSeenAt - 61000 WHERE deviceId = ?', target)
  })
}

const adminGet = (path: string) => shopStub(shopId).fetch(`https://shop.internal/internal/admin/${path}`)

function dataQuery(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()
}

const adminData = (params: Record<string, string | number>) => adminGet(`data?${dataQuery(params)}`)

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key))
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([name, child]) => name === key || containsKey(child, key))
}

async function pairAnotherDevice(letter: string, label: string): Promise<{ deviceId: string; token: string }> {
  const codeResponse = await post(`/shop/${shopId}/pair-code`, {})
  expect(codeResponse.status).toBe(201)
  const { code } = await codeResponse.json<{ code: string }>()
  const paired = await SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({ code, letter, label, hasLocalLedger: false, localLedgerRows: 0 }),
  })
  expect(paired.status).toBe(201)
  return paired.json<{ deviceId: string; token: string }>()
}

async function seedSalesBook() {
  const c1 = crypto.randomUUID()
  const c2 = crypto.randomUUID()
  const o1 = crypto.randomUUID()
  const o2 = crypto.randomUUID()
  const o3 = crypto.randomUUID()
  const p1 = crypto.randomUUID()
  await accepted(push(event('customers', c1, customerRow(c1, 'Hoa'))))
  await accepted(push(event('customers', c2, customerRow(c2, 'Lan'))))

  const first = orderRow(o1, c1, { total: 100_000, soldAt: 1000, code: 'PBH-260810-A001' })
  await accepted(push(event('orders', o1, first.after, first.refs)))

  const voided = orderRow(o2, c1, { total: 50_000, soldAt: 1500, code: 'PBH-260810-A002' })
  await accepted(push(event('orders', o2, voided.after, voided.refs)))
  await accepted(
    push(event('orders', o2, { ...voided.after, status: 'void' }, voided.refs, 'put', voided.after)),
  )

  const third = orderRow(o3, c2, { total: 30_000, soldAt: 2000, code: 'PBH-260810-A003' })
  await accepted(push(event('orders', o3, third.after, third.refs)))

  await accepted(
    push(event('payments', p1, paymentRow(p1, 40_000), { orderId: o1, allocatedOrderId: null, customerId: c1 })),
  )
  return { c1, c2, o1, o2, o3, p1 }
}

async function seedOrders(count: number): Promise<string[]> {
  const customerGid = crypto.randomUUID()
  await accepted(push(event('customers', customerGid, customerRow(customerGid))))
  const gids: string[] = []
  for (let i = 0; i < count; i++) {
    const gid = crypto.randomUUID()
    const order = orderRow(gid, customerGid, { total: 10_000 + i, soldAt: 1000 + i, code: `PBH-260810-B${i}` })
    await accepted(push(event('orders', gid, order.after, order.refs)))
    gids.push(gid)
  }
  return gids
}

beforeEach(async () => {
  const created = await SELF.fetch('https://example.com/shop', {
    method: 'POST',
    headers: { ...headers, authorization: 'Bearer test-admin-secret' },
  })
  const shop = await created.json<{ shopId: string; code: string }>()
  shopId = shop.shopId
  const paired = await SELF.fetch('https://example.com/pair', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: shop.code,
      letter: 'A',
      label: 'Quầy trước',
      hasLocalLedger: false,
      localLedgerRows: 0,
    }),
  })
  const device = await paired.json<{ token: string; deviceId: string }>()
  token = device.token
  deviceId = device.deviceId
  expect(
    (
      await SELF.fetch(`https://example.com/shop/${shopId}/seed`, {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ events: [] }),
      })
    ).status,
  ).toBe(201)
  expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
})

describe('tiến độ kéo của từng máy', () => {
  it('ghi dòng tiến độ cho máy ở lần kéo đầu tiên', async () => {
    await pushCustomers(2)
    expect((await oplog(0)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ deviceId, pulledSeq: 0, rewoundAt: null, lastSeenAt: expect.any(Number) })
  })

  it('pulledSeq là since báo gần nhất, không lấy max, qua các lần lùi đồng hồ', async () => {
    await pushCustomers(9)
    expect((await oplog(0)).status).toBe(200)
    await rewindClock()
    expect((await oplog(5)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 5, rewoundAt: null })
    await rewindClock()
    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9, rewoundAt: null })
  })

  it('không ghi lại khi máy tiến tới trong vòng 60 giây, kể cả khi since tăng', async () => {
    await pushCustomers(9)
    expect((await oplog(0)).status).toBe(200)
    const before = await activityOf()
    expect((await oplog(5)).status).toBe(200)
    expect(await activityOf()).toEqual(before)
    expect(before).toMatchObject({ pulledSeq: 0 })
  })

  it('trang kéo tới seq 9 vẫn chỉ đặt pulledSeq 5 cho tới lần kéo sau khi đã qua 60 giây', async () => {
    await pushCustomers(9)
    expect((await oplog(0)).status).toBe(200)
    await rewindClock()
    const page = await (await oplog(5)).json<{ events: Array<{ seq: number }> }>()
    expect(page.events.map((entry) => entry.seq)).toEqual([6, 7, 8, 9])
    expect(await activityOf()).toMatchObject({ pulledSeq: 5 })

    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 5 })

    await rewindClock()
    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9 })
  })

  it('since nhỏ hơn mốc đã báo đặt rewoundAt, và lần kéo tới sau đó không xoá rewoundAt', async () => {
    await pushCustomers(9)
    expect((await oplog(0)).status).toBe(200)
    await rewindClock()
    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9, rewoundAt: null })

    await rewindClock()
    expect((await oplog(0)).status).toBe(200)
    const rewound = await activityOf()
    expect(rewound).toMatchObject({ pulledSeq: 0 })
    expect(rewound?.rewoundAt).toEqual(expect.any(Number))

    await rewindClock()
    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9, rewoundAt: rewound?.rewoundAt })
  })

  it('kéo lại trong cửa sổ 60 giây vẫn đặt rewoundAt khi đến lần ghi kế tiếp', async () => {
    await pushCustomers(9)
    expect((await oplog(9)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9, rewoundAt: null })

    expect((await oplog(0)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 9, rewoundAt: null })

    await rewindClock()
    expect((await oplog(500)).status).toBe(200)
    expect(await activityOf()).toMatchObject({ pulledSeq: 500 })
    expect((await activityOf())?.rewoundAt).toEqual(expect.any(Number))
  })

  it('since không hợp lệ bị 400 và không ghi tiến độ', async () => {
    expect((await oplog(-1)).status).toBe(400)
    expect(await activityOf()).toBeNull()
  })

  it('tạo chỉ mục ledger_seq sau một lần kéo', async () => {
    expect((await oplog(0)).status).toBe(200)
    const rows = await withSql((sql) => [
      ...sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name='ledger_seq'"),
    ])
    expect(rows).toHaveLength(1)
  })

  it('sổ đời cũ mất bảng deviceActivity vẫn kéo đúng body, và sau hai lần kéo bảng được tạo lại có dòng của máy', async () => {
    await pushCustomers(2)
    const first = await (await oplog(0)).json()
    await withSql((sql) => {
      sql.exec('DROP TABLE IF EXISTS deviceActivity')
    })

    const afterDrop = await oplog(0)
    expect(afterDrop.status).toBe(200)
    expect(await afterDrop.json()).toEqual(first)

    const again = await oplog(0)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(first)
    expect(await activityOf()).toMatchObject({ deviceId, pulledSeq: 0 })
  })

  it('lỗi ghi tiến độ không đổi body của phản hồi kéo', async () => {
    await pushCustomers(2)
    const baseline = await (await oplog(0)).json()
    await withSql((sql) => {
      sql.exec('DROP TABLE IF EXISTS deviceActivity')
      sql.exec('CREATE TABLE deviceActivity (unrelated INTEGER)')
    })
    const broken = await oplog(0)
    expect(broken.status).toBe(200)
    expect(await broken.json()).toEqual(baseline)
  })

  it('lỗi tạo schema admin không chặn ghép máy, ghi sổ hay kéo', async () => {
    const id = crypto.randomUUID()
    await withSql((sql) => {
      sql.exec('CREATE TABLE ledger_seq (blocked INTEGER)')
    }, id)
    const boot = await shopStub(id).fetch('https://shop.internal/internal/bootstrap', {
      method: 'POST',
      headers,
      body: JSON.stringify({ shopId: id }),
    })
    expect(boot.status).toBe(201)
    const { code } = await boot.json<{ code: string }>()

    shopId = id
    const paired = await SELF.fetch('https://example.com/pair', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, letter: 'A', label: 'Quầy trước', hasLocalLedger: false, localLedgerRows: 0 }),
    })
    expect(paired.status).toBe(201)
    const device = await paired.json<{ token: string; deviceId: string }>()
    token = device.token
    deviceId = device.deviceId

    const seeded = await SELF.fetch(`https://example.com/shop/${shopId}/seed`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ events: [] }),
    })
    expect(seeded.status).toBe(201)
    expect((await post(`/shop/${shopId}/epoch`, { epoch: 1 })).status).toBe(200)
    await pushCustomers(2)

    const pulled = await oplog(0)
    expect(pulled.status).toBe(200)
    const body = await pulled.json<{ events: unknown[] }>()
    expect(body.events).toHaveLength(2)
  })
})

describe('/internal/admin/identity', () => {
  it('trả mã sổ và thời điểm tạo, mã sổ lấy từ cột id của bảng shop', async () => {
    const response = await adminGet('identity')
    expect(response.status).toBe(200)
    const body = await response.json<IdentityBody>()
    expect(body).toEqual({ shopId, createdAt: expect.any(Number) })
    const row = await withSql((sql) => [...sql.exec<{ createdAt: number }>('SELECT createdAt FROM shop LIMIT 1')][0])
    expect(body.createdAt).toBe(row?.createdAt)
  })

  it('DO chưa khởi tạo trả 404 cho cả ba route admin', async () => {
    const fresh = env.SHOP_DO.get(env.SHOP_DO.newUniqueId())
    for (const path of ['identity', 'overview', 'data?table=orders&after=0&limit=1']) {
      const response = await fresh.fetch(`https://shop.internal/internal/admin/${path}`)
      expect(response.status).toBe(404)
    }
  })

  it('đường công khai /shop/{id}/internal/... không chuyển tiếp tới route admin', async () => {
    for (const path of ['identity', 'overview', 'data?table=orders&after=0&limit=1']) {
      const response = await SELF.fetch(`https://example.com/shop/${shopId}/internal/admin/${path}`, {
        headers: auth(),
      })
      expect(response.status).toBe(404)
    }
  })

  it('chỉ nhận GET: POST tới route admin trả 404', async () => {
    for (const path of ['identity', 'overview', 'data?table=orders&after=0&limit=1']) {
      const response = await shopStub(shopId).fetch(`https://shop.internal/internal/admin/${path}`, {
        method: 'POST',
      })
      expect(response.status).toBe(404)
    }
  })
})

describe('/internal/admin/overview', () => {
  it('trả ShopOverview với mã sổ, tên quán, latestSeq và tiến độ của từng máy', async () => {
    await accepted(push(event('settings', 'shop', { key: 'shop', value: { name: 'Quán Hoa Sen', phone: '', address: '', footerNote: '' } })))
    await pushCustomers(2)
    const events = await (await oplog(0)).json<{ events: Array<{ seq: number }> }>()
    const latestSeq = Math.max(...events.events.map((entry) => entry.seq))
    await rewindClock()
    expect((await oplog(3)).status).toBe(200)

    const other = await pairAnotherDevice('B', 'Quầy trong')
    // Máy chưa nạp sổ bị thu hồi thì bị xoá hẳn; phải nạp trước để còn dòng có revokedAt.
    expect(
      (
        await SELF.fetch(`https://example.com/shop/${shopId}/seed`, {
          method: 'POST',
          headers: { ...headers, authorization: `Bearer ${other.token}` },
          body: JSON.stringify({ events: [] }),
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await SELF.fetch(`https://example.com/shop/${shopId}/devices/${other.deviceId}/revoke`, {
          method: 'POST',
          headers: auth(),
        })
      ).status,
    ).toBe(200)

    const response = await adminGet('overview')
    expect(response.status).toBe(200)
    const body = await response.json<ShopOverview>()
    expect(body).toMatchObject({ shopId, shopName: 'Quán Hoa Sen', latestSeq })
    expect(body.createdAt).toEqual(expect.any(Number))
    expect(body.devices).toEqual([
      {
        id: deviceId,
        letter: 'A',
        label: 'Quầy trước',
        createdAt: expect.any(Number),
        revokedAt: null,
        lastSeenAt: expect.any(Number),
        pulledSeq: 3,
        rewoundAt: null,
      },
      {
        id: other.deviceId,
        letter: 'B',
        label: 'Quầy trong',
        createdAt: expect.any(Number),
        revokedAt: expect.any(Number),
        lastSeenAt: null,
        pulledSeq: null,
        rewoundAt: null,
      },
    ])
  })

  it('shopName là null khi sổ chưa có bản ghi thông tin quán', async () => {
    const body = await (await adminGet('overview')).json<ShopOverview>()
    expect(body.shopName).toBeNull()
  })

  it('không lộ tokenHash ở bất kỳ khoá nào hay trong nội dung JSON', async () => {
    const other = await pairAnotherDevice('B', 'Quầy trong')
    expect(other.deviceId).toEqual(expect.any(String))
    const tokenHash = await withSql((sql) => [
      ...sql.exec<{ tokenHash: string }>('SELECT tokenHash FROM devices WHERE id = ?', deviceId),
    ][0]?.tokenHash)
    expect(tokenHash).toEqual(expect.any(String))

    const response = await adminGet('overview')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(containsKey(JSON.parse(text), 'tokenHash')).toBe(false)
    expect(text).not.toContain(tokenHash ?? '')
  })

  it('summary khớp summarizeServerLedger trên sổ có nợ, có trả trước và có đơn huỷ', async () => {
    await seedSalesBook()

    const body = await (await adminGet('overview')).json<ShopOverview>()
    expect(body.summary).toEqual({ orderCount: 3, customerCount: 2, debtTotal: 90_000, revenue: 130_000 })

    const rows = await withSql((sql) => [
      ...sql.exec<{ tableName: string; payload: string }>(
        "SELECT tableName, payload FROM ledger WHERE tableName IN ('orders', 'payments', 'customers')",
      ),
    ])
    const { orderCount, customerCount, debtTotal, revenue } = summarizeServerLedger(rows)
    expect(body.summary).toEqual({ orderCount, customerCount, debtTotal, revenue })
  })

  it('latestSeq là seq lớn nhất trong oplog', async () => {
    await seedSalesBook()
    const pulled = await (await oplog(0)).json<{ events: Array<{ seq: number }> }>()
    const latestSeq = Math.max(...pulled.events.map((entry) => entry.seq))
    const body = await (await adminGet('overview')).json<ShopOverview>()
    expect(body.latestSeq).toBe(latestSeq)
  })

  it('debts=1 trả công nợ theo khách kèm tên khách, nợ lâu nhất đứng trước', async () => {
    const { c1, c2, o1, o3 } = await seedSalesBook()
    // Server đóng dấu soldAt bằng giờ nhận đơn, nên mốc nợ phải đọc lại từ sổ chứ không phải giá trị máy gửi.
    const soldAtOf = (gid: string) =>
      withSql((sql) => {
        const row = [
          ...sql.exec<{ payload: string }>("SELECT payload FROM ledger WHERE tableName = 'orders' AND entityKey = ?", gid),
        ][0]
        return (JSON.parse(row?.payload ?? '{}') as { after: { soldAt: number } }).after.soldAt
      })
    const [first, third] = [await soldAtOf(o1), await soldAtOf(o3)]
    expect(first).toBeLessThan(third)
    const body = await (await adminGet('overview?debts=1')).json<ShopDetail>()
    expect(body.debts).toEqual([
      { customerGid: c1, name: 'Hoa', total: 60_000, orderCount: 1, oldestAt: first },
      { customerGid: c2, name: 'Lan', total: 30_000, orderCount: 1, oldestAt: third },
    ])
  })

  it('debts có name null khi hàng khách không còn trong sổ', async () => {
    const orphanCustomer = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    await withSql((sql) => {
      sql.exec(
        'INSERT INTO ledger (tableName, entityKey, payload, updatedSeq) VALUES (?, ?, ?, ?)',
        'orders',
        orderGid,
        JSON.stringify({
          after: { gid: orderGid, total: 10_000, paidAmount: 0, soldAt: 2500, status: 'unpaid' },
          refs: { customerId: orphanCustomer },
        }),
        999,
      )
    })
    const body = await (await adminGet('overview?debts=1')).json<ShopDetail>()
    expect(body.debts).toEqual([
      { customerGid: orphanCustomer, name: null, total: 10_000, orderCount: 1, oldestAt: 2500 },
    ])
  })

  it('overview không có debts khi không truyền debts=1', async () => {
    await seedSalesBook()
    const body = await (await adminGet('overview')).json<Record<string, unknown>>()
    expect(body).not.toHaveProperty('debts')
  })
})

describe('/internal/admin/data', () => {
  it('lật trang orders theo updatedSeq thu đủ mọi dòng, next là updatedSeq cuối khi đủ limit', async () => {
    const gids = await seedOrders(5)
    const pages: AdminDataPage[] = []
    let after = 0
    for (let i = 0; i < 10; i++) {
      const page = await (await adminData({ table: 'orders', after, limit: 2 })).json<AdminDataPage>()
      pages.push(page)
      if (page.next === null) break
      after = page.next
    }
    expect(pages.map((page) => page.rows.length)).toEqual([2, 2, 1])
    expect(pages.map((page) => page.next)).toEqual([
      pages[0]?.rows[1]?.updatedSeq,
      pages[1]?.rows[1]?.updatedSeq,
      null,
    ])
    expect(pages.flatMap((page) => page.rows.map((row) => row.entityKey)).sort()).toEqual([...gids].sort())
    expect(pages[0]?.rows[0]).toMatchObject({ entityKey: gids[0], after: { gid: gids[0] } })
  })

  it('table ngoài danh sách trả 400', async () => {
    expect((await adminData({ table: 'khong-co', after: 0, limit: 10 })).status).toBe(400)
  })

  it('limit ngoài 1..200 hoặc không phải số trả 400', async () => {
    for (const limit of [0, 201, 'abc']) {
      expect((await adminData({ table: 'orders', after: 0, limit })).status).toBe(400)
    }
  })

  it('after âm trả 400', async () => {
    expect((await adminData({ table: 'orders', after: -1, limit: 10 })).status).toBe(400)
  })

  it('limit 200 là giới hạn được nhận', async () => {
    expect((await adminData({ table: 'orders', after: 0, limit: 200 })).status).toBe(200)
  })

  it('orderIds chỉ lọc dòng đơn của các đơn được nêu', async () => {
    const customerGid = crypto.randomUUID()
    await accepted(push(event('customers', customerGid, customerRow(customerGid))))
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, gid] of [a, b, c].entries()) {
      const order = orderRow(gid, customerGid, { total: 25_000, soldAt: 1000, code: `PBH-260810-C${index}` })
      await accepted(push(event('orders', gid, order.after, order.refs)))
    }
    const lines = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const owners = [a, a, b, c]
    for (const [index, lineGid] of lines.entries()) {
      const owner = owners[index] ?? a
      await accepted(push(event('orderLines', lineGid, lineRow(lineGid), lineRefs(owner))))
    }

    const page = await (
      await adminData({ table: 'orderLines', after: 0, limit: 10, orderIds: `${a},${b}` })
    ).json<AdminDataPage>()
    expect(page.rows.map((row) => row.entityKey).sort()).toEqual([lines[0], lines[1], lines[2]].sort())
    expect(page.next).toBeNull()
    expect(page.rows[0]?.refs).toMatchObject({ orderId: expect.any(String) })
  })

  it('orderIds đúng 50 gid được nhận, 51 gid trả 400', async () => {
    const fifty = Array.from({ length: 50 }, () => crypto.randomUUID()).join(',')
    const fiftyOne = [...fifty.split(','), crypto.randomUUID()].join(',')
    const ok = await adminData({ table: 'orderLines', after: 0, limit: 10, orderIds: fifty })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as AdminDataPage).rows).toEqual([])
    expect((await adminData({ table: 'orderLines', after: 0, limit: 10, orderIds: fiftyOne })).status).toBe(400)
  })

  it('orderIds không phải danh sách UUID hợp lệ hoặc rỗng trả 400', async () => {
    expect((await adminData({ table: 'orderLines', after: 0, limit: 10, orderIds: 'khong-phai-uuid' })).status).toBe(400)
    expect((await adminData({ table: 'orderLines', after: 0, limit: 10, orderIds: '' })).status).toBe(400)
  })

  it('orderIds đi kèm bảng khác orderLines trả 400', async () => {
    const gid = crypto.randomUUID()
    expect((await adminData({ table: 'orders', after: 0, limit: 10, orderIds: gid })).status).toBe(400)
  })
})
