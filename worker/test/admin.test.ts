import { createExecutionContext, env as testEnv, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  AdminDataPage,
  AdminShopsPage,
  ReconcileResult,
  ShopDetail,
  UnpairedPage,
} from '../../shared/admin-contract'
import type { SyncEvent } from '../../shared/sync-events'
import type { Env } from '../src/env'
import worker from '../src/index'

const env = testEnv as unknown as Env

const adminSecret = 'test-admin-secret'
const viewSecret = 'test-admin-view-secret-0123456789abcdef'
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

type Created = { shopId: string; code: string }
type Paired = { shopId: string; deviceId: string; token: string; letter: string }
type ShopRow = { shopId: string; createdAt: number; via: string; indexedAt: number }
type HeartbeatRow = {
  installId: string
  shopName: string
  appVersion: string
  platform: string
  orderCount: number
  customerCount: number
  debtTotal: number
  firstSeenAt: number
  lastSeenAt: number
  pairedShopId: string | null
  pairedAt: number | null
}
type QueryCounts = { statements: number; batches: number }
type ListedShop = AdminShopsPage['shops'][number]

async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(new Request(`https://example.com${path}`, init), { ...env, ...overrides }, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

/** D1 treo tới khi gọi `release`, rồi mọi lời gọi đang chờ đều lỗi. */
function hangingDb(): { db: D1Database; release: () => void } {
  const waiting: (() => void)[] = []
  const hang = () =>
    new Promise<never>((_, reject) => {
      waiting.push(() => reject(new Error('D1 tạm thời lỗi')))
    })
  const statement = { bind: () => statement, run: hang, first: hang, all: hang, raw: hang }
  const db = { prepare: () => statement, batch: hang, exec: hang } as unknown as D1Database
  return { db, release: () => waiting.splice(0).forEach((fail) => fail()) }
}

/** Trả status nếu Worker trả lời trong một giây khi D1 treo, `'treo'` nếu không. */
async function statusWhileD1Hangs(path: string, init: RequestInit): Promise<number | 'treo'> {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { db, release } = hangingDb()
  const ctx = createExecutionContext()
  const pending = worker.fetch(new Request(`https://example.com${path}`, init), { ...env, ADMIN_DB: db }, ctx)
  const settled = await Promise.race([
    pending.then((response) => response.status),
    new Promise<'treo'>((resolve) => setTimeout(() => resolve('treo'), 1000)),
  ])
  release()
  await pending
  await waitOnExecutionContext(ctx)
  errors.mockRestore()
  return settled
}

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

function adminGet(path: string, token = viewSecret, overrides: Partial<Env> = {}): Promise<Response> {
  return call(path, { headers: bearer(token) }, overrides)
}

function denyingLimiter(): RateLimit {
  return { limit: async () => ({ success: false }) } as unknown as RateLimit
}

function brokenStatement(): D1PreparedStatement {
  const reject = () => Promise.reject(new Error('D1 tạm thời lỗi'))
  return {
    bind: () => brokenStatement(),
    run: reject,
    first: reject,
    all: reject,
    raw: reject,
  } as unknown as D1PreparedStatement
}

function brokenDb(): D1Database {
  const reject = () => Promise.reject(new Error('D1 tạm thời lỗi'))
  return { prepare: () => brokenStatement(), batch: reject, exec: reject } as unknown as D1Database
}

function countingDb(): { db: D1Database; counts: QueryCounts } {
  const real = env.ADMIN_DB
  const counts: QueryCounts = { statements: 0, batches: 0 }
  const db = {
    prepare(sql: string) {
      counts.statements += 1
      return real.prepare(sql)
    },
    exec(sql: string) {
      counts.statements += 1
      return real.exec(sql)
    },
    batch(statements: D1PreparedStatement[]) {
      counts.batches += 1
      return real.batch(statements)
    },
  } as unknown as D1Database
  return { db, counts }
}

function recordingShopDo(received: Record<string, unknown>[]): Env['SHOP_DO'] {
  const real = env.SHOP_DO
  return {
    idFromName: (name: string) => real.idFromName(name),
    idFromString: (id: string) => real.idFromString(id),
    newUniqueId: (...args: Parameters<typeof real.newUniqueId>) => real.newUniqueId(...args),
    get: (id: DurableObjectId) => {
      const stub = real.get(id)
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init)
          if (new URL(request.url).pathname === '/pair') received.push(await request.clone().json())
          return stub.fetch(request)
        },
      }
    },
  } as unknown as Env['SHOP_DO']
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function padTo(text: string, size: number): string {
  return text + ' '.repeat(size - byteLength(text))
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function heartbeatBody(overrides: Record<string, unknown> = {}): Record<string, unknown> & { installId: string } {
  return {
    installId: crypto.randomUUID(),
    shopName: 'Quán Hoa',
    appVersion: '2.16.0',
    platform: 'apk',
    orderCount: 3,
    customerCount: 2,
    debtTotal: 50_000,
    ...overrides,
  } as Record<string, unknown> & { installId: string }
}

function heartbeat(body: unknown, overrides: Partial<Env> = {}, headers: Record<string, string> = {}): Promise<Response> {
  return call('/heartbeat', jsonRequest('POST', body, headers), overrides)
}

async function heartbeatRow(installId: string): Promise<HeartbeatRow | null> {
  return env.ADMIN_DB.prepare('SELECT * FROM heartbeats WHERE installId = ?').bind(installId).first<HeartbeatRow>()
}

async function insertHeartbeat(installId: string, lastSeenAt: number): Promise<void> {
  await env.ADMIN_DB.prepare(
    `INSERT INTO heartbeats (installId, shopName, appVersion, platform, orderCount, customerCount, debtTotal,
       firstSeenAt, lastSeenAt, pairedShopId, pairedAt)
     VALUES (?, '', '', 'apk', 0, 0, 0, ?, ?, NULL, NULL)`,
  )
    .bind(installId, lastSeenAt, lastSeenAt)
    .run()
}

async function shopRow(shopId: string): Promise<ShopRow | null> {
  return env.ADMIN_DB.prepare('SELECT shopId, createdAt, via, indexedAt FROM shops WHERE shopId = ?')
    .bind(shopId)
    .first<ShopRow>()
}

async function deleteShopRow(shopId: string): Promise<void> {
  await env.ADMIN_DB.prepare('DELETE FROM shops WHERE shopId = ?').bind(shopId).run()
}

async function createShop(): Promise<Created> {
  const response = await call('/shop', { method: 'POST', headers: bearer(adminSecret) })
  expect(response.status).toBe(201)
  return response.json<Created>()
}

async function createShops(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) ids.push((await createShop()).shopId)
  return ids
}

function pairCode(
  code: string,
  letter = 'A',
  extra: Record<string, unknown> = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  return call(
    '/pair',
    jsonRequest('POST', { code, letter, label: `Máy ${letter}`, hasLocalLedger: false, localLedgerRows: 0, ...extra }),
    overrides,
  )
}

async function pairedShop(): Promise<{ shopId: string; device: Paired }> {
  const shop = await createShop()
  const response = await pairCode(shop.code)
  expect(response.status).toBe(201)
  const device = await response.json<Paired>()
  const seeded = await call(`/shop/${shop.shopId}/seed`, jsonRequest('POST', { events: [] }, bearer(device.token)))
  expect(seeded.status).toBe(201)
  return { shopId: shop.shopId, device }
}

function claimEpoch(shopId: string, token: string, epoch = 1): Promise<Response> {
  return call(`/shop/${shopId}/epoch`, jsonRequest('POST', { epoch }, bearer(token)))
}

async function pushCustomer(shopId: string, token: string, name: string): Promise<void> {
  const gid = crypto.randomUUID()
  const event: SyncEvent = {
    eventId: crypto.randomUUID(),
    txId: crypto.randomUUID(),
    txOrder: 0,
    table: 'customers',
    entityKey: gid,
    entityGid: gid,
    operation: 'create',
    before: null,
    after: { gid, name, phone: '', address: '', note: '', createdAt: 1, updatedAt: 1 },
    refs: {},
  }
  const response = await call(
    `/shop/${shopId}/events`,
    jsonRequest('POST', { epoch: 1, event, deviceId: crypto.randomUUID(), caps: [] }, bearer(token)),
  )
  expect(response.status).toBe(201)
}

async function listAllShops(limit: number): Promise<ListedShop[]> {
  const all: ListedShop[] = []
  let cursor = ''
  for (let page = 0; page < 200; page += 1) {
    const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const response = await adminGet(`/admin/shops?${query}`)
    expect(response.status).toBe(200)
    const body = await response.json<AdminShopsPage>()
    expect(body.shops.length).toBeLessThanOrEqual(limit)
    all.push(...body.shops)
    if (body.next === null) return all
    cursor = body.next
  }
  throw new Error('Danh sách sổ không kết thúc sau 200 trang')
}

async function directDo(shopId: string, path: string): Promise<unknown> {
  const response = await env.SHOP_DO.get(env.SHOP_DO.idFromName(shopId)).fetch(`https://shop.internal${path}`)
  return response.json()
}

function reconcile(ids: unknown, overrides: Partial<Env> = {}, token = adminSecret): Promise<Response> {
  return call('/admin/index/reconcile', jsonRequest('POST', { ids }, bearer(token)), overrides)
}

beforeAll(async () => {
  await adminGet('/admin/devices/unpaired')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('xác thực khu xem admin', () => {
  it('từ chối mọi GET /admin/* khi thiếu bearer, sai bearer hoặc dùng ADMIN_SECRET', async () => {
    const id = crypto.randomUUID()
    const paths = [
      '/admin/shops',
      `/admin/shops/${id}`,
      `/admin/shops/${id}/data?table=orders`,
      '/admin/devices/unpaired',
    ]
    const credentials: [string, Record<string, string>][] = [
      ['thiếu bearer', {}],
      ['bearer sai', bearer('khong-dung-mat-khau')],
      ['bearer ADMIN_SECRET', bearer(adminSecret)],
    ]
    for (const path of paths) {
      for (const [label, headers] of credentials) {
        const response = await call(path, { headers })
        expect(response.status, `${path} với ${label}`).toBe(401)
      }
    }
  })

  it('trả 401 cho đường admin không tồn tại khi thiếu bearer', async () => {
    const response = await call('/admin/khong-co')
    expect(response.status).toBe(401)
  })

  it('không cho ADMIN_VIEW_SECRET mở POST /shop', async () => {
    const response = await call('/shop', { method: 'POST', headers: bearer(viewSecret) })
    expect(response.status).toBe(401)
  })

  it('không cho ADMIN_VIEW_SECRET mở reconcile', async () => {
    const response = await reconcile([env.SHOP_DO.newUniqueId().toString()], {}, viewSecret)
    expect(response.status).toBe(401)
  })

  it('khoá khu xem khi ADMIN_VIEW_SECRET trùng ADMIN_SECRET dù bearer đúng', async () => {
    const overrides = { ADMIN_VIEW_SECRET: adminSecret }
    for (const path of ['/admin/shops', '/admin/devices/unpaired']) {
      const response = await adminGet(path, adminSecret, overrides)
      expect(response.status, path).toBe(401)
    }
  })

  it('khoá khu xem khi ADMIN_VIEW_SECRET dưới 32 ký tự hoặc thiếu', async () => {
    const short = await adminGet('/admin/shops', 'ngan-qua', { ADMIN_VIEW_SECRET: 'ngan-qua' })
    expect(short.status).toBe(401)

    const missing = await adminGet('/admin/shops', viewSecret, { ADMIN_VIEW_SECRET: undefined })
    expect(missing.status).toBe(401)
  })

  it('chấp nhận ADMIN_VIEW_SECRET đúng 32 ký tự', async () => {
    const secret = 'x'.repeat(32)
    const response = await adminGet('/admin/devices/unpaired', secret, { ADMIN_VIEW_SECRET: secret })
    expect(response.status).toBe(200)
  })

  it('trả 429 khi bearer xem sai và hết quota, còn bearer đúng vẫn 200', async () => {
    const overrides = { PAIR_RATE_LIMITER: denyingLimiter() }
    const ip = { 'cf-connecting-ip': '203.0.113.42' }

    const wrong = await call('/admin/shops', { headers: { ...bearer('sai-mat-khau'), ...ip } }, overrides)
    expect(wrong.status).toBe(429)

    const right = await call('/admin/devices/unpaired', { headers: { ...bearer(viewSecret), ...ip } }, overrides)
    expect(right.status).toBe(200)
  })

  it('bỏ qua limiter khi thiếu cf-connecting-ip và trả 401 cho bearer sai', async () => {
    const response = await adminGet('/admin/shops', 'sai-mat-khau', { PAIR_RATE_LIMITER: denyingLimiter() })
    expect(response.status).toBe(401)
  })

  it('từ chối POST trên /admin/shops bằng 404 và trả CORS cho OPTIONS', async () => {
    const post = await call('/admin/shops', { method: 'POST', headers: bearer(viewSecret) })
    expect(post.status).toBe(404)

    const preflight = await call('/admin/shops', { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('danh sách sổ', () => {
  it('liệt kê sổ tạo qua POST /shop kèm tiến độ máy và không lộ tokenHash', async () => {
    const { shopId, device } = await pairedShop()
    const others = await createShops(2)
    const pulled = await call(`/shop/${shopId}/oplog?since=0`, { headers: bearer(device.token) })
    expect(pulled.status).toBe(200)

    const listed = await listAllShops(2)
    for (const id of [shopId, ...others]) {
      expect(listed.find((shop) => shop.shopId === id)).toMatchObject({ shopId: id, via: 'create' })
    }
    expect(listed.find((shop) => shop.shopId === shopId)).toMatchObject({
      devices: expect.arrayContaining([expect.objectContaining({ id: device.deviceId, pulledSeq: expect.any(Number) })]),
    })

    const text = JSON.stringify(listed)
    expect(text).not.toContain('tokenHash')
    expect(text).not.toContain(device.token)
  })

  it('phân trang bằng cursor và limit, sắp theo shopId', async () => {
    await createShops(3)
    const first = await adminGet('/admin/shops?limit=2')
    expect(first.status).toBe(200)
    const firstPage = await first.json<AdminShopsPage>()
    expect(firstPage.shops).toHaveLength(2)
    const cursor = firstPage.shops[1]?.shopId
    expect(firstPage.next).toBe(cursor)

    const second = await adminGet(`/admin/shops?limit=2&cursor=${encodeURIComponent(cursor ?? '')}`)
    const secondPage = await second.json<AdminShopsPage>()
    expect(secondPage.shops.length).toBeGreaterThan(0)
    for (const shop of secondPage.shops) expect(shop.shopId > (cursor ?? '')).toBe(true)

    const walked = (await listAllShops(2)).map((shop) => shop.shopId)
    expect(walked).toEqual([...walked].sort())
    expect(new Set(walked).size).toBe(walked.length)
  })

  it('từ chối limit ngoài khoảng 1..20 bằng 400', async () => {
    expect((await adminGet('/admin/shops?limit=21')).status).toBe(400)
    expect((await adminGet('/admin/shops?limit=0')).status).toBe(400)
  })

  it('sổ có DO lỗi trả phần tử {shopId, error} và không chặn các sổ khác', async () => {
    const orphan = crypto.randomUUID()
    await env.ADMIN_DB.prepare("INSERT INTO shops (shopId, createdAt, via, indexedAt) VALUES (?, ?, 'backfill', ?)")
      .bind(orphan, Date.now(), Date.now())
      .run()

    const listed = await listAllShops(20)
    expect(listed.find((shop) => shop.shopId === orphan)).toEqual({ shopId: orphan, error: expect.any(String) })
    const healthy = listed.find((shop) => 'devices' in shop)
    expect(healthy).toBeDefined()
  })
})

describe('chi tiết và dữ liệu một sổ', () => {
  it('mã sổ có phần trăm mã hoá hỏng trả 404, không phải 503', async () => {
    expect((await adminGet('/admin/shops/%E0')).status).toBe(404)
    expect((await adminGet('/admin/shops/%E0/data?table=orders')).status).toBe(404)
  })

  it('/admin/shops/{id} trả overview kèm debts, khớp với DO', async () => {
    const shop = await createShop()
    const response = await adminGet(`/admin/shops/${shop.shopId}`)
    expect(response.status).toBe(200)
    const body = await response.json<ShopDetail>()
    expect(body.shopId).toBe(shop.shopId)
    expect(Array.isArray(body.debts)).toBe(true)
    expect(body).toEqual(await directDo(shop.shopId, '/internal/admin/overview?debts=1'))
  })

  it('/admin/shops/{id}/data chuyển đúng table, limit và after tới DO', async () => {
    const { shopId, device } = await pairedShop()
    expect((await claimEpoch(shopId, device.token)).status).toBe(200)
    await pushCustomer(shopId, device.token, 'Hoa')
    await pushCustomer(shopId, device.token, 'Lan')

    const response = await adminGet(`/admin/shops/${shopId}/data?table=customers&after=0&limit=1`)
    expect(response.status).toBe(200)
    const page = await response.json<AdminDataPage>()
    expect(page.rows).toHaveLength(1)
    expect(page.next).toEqual(expect.any(Number))
    expect(page).toEqual(await directDo(shopId, '/internal/admin/data?table=customers&after=0&limit=1'))
  })

  it('từ chối id sai dạng ở chi tiết và dữ liệu bằng 404, id đúng dạng vẫn được phục vụ', async () => {
    const shop = await createShop()
    expect((await adminGet(`/admin/shops/${shop.shopId}`)).status).toBe(200)
    expect((await adminGet(`/admin/shops/${shop.shopId}/data?table=customers&limit=50`)).status).toBe(200)
    expect((await adminGet('/admin/shops/zz')).status).toBe(404)
    expect((await adminGet('/admin/shops/zz/data?table=customers')).status).toBe(404)
  })
})

describe('reconcile chỉ mục', () => {
  it('từ chối id sai dạng, danh sách rỗng và quá 20 id, không ghi dòng nào', async () => {
    const shopId = (await createShop()).shopId
    await deleteShopRow(shopId)

    const malformed = await reconcile([env.SHOP_DO.idFromName(shopId).toString(), 'zz'])
    expect(malformed.status).toBe(400)
    expect((await reconcile([])).status).toBe(400)

    const tooMany = Array.from({ length: 21 }, () => env.SHOP_DO.newUniqueId().toString())
    expect((await reconcile(tooMany)).status).toBe(400)

    expect(await shopRow(shopId)).toBeNull()
  })

  it('ghi sổ đã khởi tạo, bỏ qua id chưa khởi tạo, rồi báo đã có khi gửi lại', async () => {
    const shopId = (await createShop()).shopId
    await deleteShopRow(shopId)
    const uninitialized = env.SHOP_DO.newUniqueId().toString()
    const ids = [env.SHOP_DO.idFromName(shopId).toString(), uninitialized]

    const first = await reconcile(ids)
    expect(first.status).toBe(200)
    expect(await first.json<ReconcileResult>()).toEqual({
      registered: 1,
      alreadyIndexed: 0,
      skipped: [{ id: uninitialized, reason: 'not-initialized' }],
    })

    const row = await shopRow(shopId)
    expect(row).toMatchObject({ shopId, via: 'backfill' })
    const identity = (await directDo(shopId, '/internal/admin/identity')) as { createdAt: number }
    expect(row?.createdAt).toBe(identity.createdAt)

    const again = await reconcile(ids)
    expect(await again.json<ReconcileResult>()).toMatchObject({ registered: 0, alreadyIndexed: 1 })
  })

  it('bỏ qua sổ có id không khớp idFromName(shopId) với lý do id-mismatch', async () => {
    const stub = env.SHOP_DO.get(env.SHOP_DO.idFromName('khac'))
    const boot = await stub.fetch('https://shop.internal/internal/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId: crypto.randomUUID() }),
    })
    expect(boot.status).toBe(201)

    const response = await reconcile([env.SHOP_DO.idFromName('khac').toString()])
    expect(response.status).toBe(200)
    expect(await response.json<ReconcileResult>()).toEqual({
      registered: 0,
      alreadyIndexed: 0,
      skipped: [{ id: env.SHOP_DO.idFromName('khac').toString(), reason: 'id-mismatch' }],
    })
  })

  it('reconcile 20 id ghi bằng đúng một batch và không quá 50 câu D1', async () => {
    const shopIds = await createShops(20)
    for (const id of shopIds) await deleteShopRow(id)
    await adminGet('/admin/devices/unpaired')

    const { db, counts } = countingDb()
    const ids = shopIds.map((id) => env.SHOP_DO.idFromName(id).toString())
    const response = await reconcile(ids, { ADMIN_DB: db })
    expect(response.status).toBe(200)
    expect(await response.json<ReconcileResult>()).toMatchObject({ registered: 20, alreadyIndexed: 0 })
    expect(counts.batches).toBe(1)
    expect(counts.statements).toBeLessThanOrEqual(50)
  })

  it('GET /admin/shops?limit=20 không quá 50 câu D1', async () => {
    await createShops(20)

    const { db, counts } = countingDb()
    const response = await adminGet('/admin/shops?limit=20', viewSecret, { ADMIN_DB: db })
    expect(response.status).toBe(200)
    const page = await response.json<AdminShopsPage>()
    expect(page.shops).toHaveLength(20)
    expect(counts.statements).toBeLessThanOrEqual(50)
  })
})

describe('heartbeat máy chưa ghép', () => {
  it('đếm máy mới trong 24 giờ dùng chỉ mục firstSeenAt, không quét cả bảng', async () => {
    expect((await adminGet('/admin/devices/unpaired')).status).toBe(200)
    const plan = await env.ADMIN_DB.prepare(
      'EXPLAIN QUERY PLAN SELECT COUNT(*) AS new24h FROM heartbeats WHERE firstSeenAt >= ?',
    )
      .bind(0)
      .all<{ detail: string }>()
    expect(plan.results.map((row) => row.detail).join(' ')).toMatch(/USING (COVERING )?INDEX/)
  })

  it('nhận heartbeat hợp lệ, hiện ở danh sách chưa ghép và giữ một dòng khi gửi lại', async () => {
    const body = heartbeatBody()
    expect((await heartbeat(body)).status).toBe(204)
    const first = await heartbeatRow(body.installId)
    expect(first).toMatchObject({ shopName: 'Quán Hoa', platform: 'apk', orderCount: 3, debtTotal: 50_000 })
    expect(first?.firstSeenAt).toEqual(expect.any(Number))

    const listed = await (await adminGet('/admin/devices/unpaired')).json<UnpairedPage>()
    expect(listed.devices.find((device) => device.installId === body.installId)).toMatchObject({
      firstSeenAt: expect.any(Number),
      pairedShopId: null,
      pairedAt: null,
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await heartbeat({ ...body, shopName: 'Quán mới' })).status).toBe(204)
    const second = await heartbeatRow(body.installId)
    expect(second?.firstSeenAt).toBe(first?.firstSeenAt)
    expect(second?.shopName).toBe('Quán mới')
    const count = await env.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM heartbeats WHERE installId = ?')
      .bind(body.installId)
      .first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('tổng và số máy mới trong 24 giờ tăng đúng số heartbeat mới', async () => {
    const before = await (await adminGet('/admin/devices/unpaired')).json<UnpairedPage>()
    for (let index = 0; index < 3; index += 1) expect((await heartbeat(heartbeatBody())).status).toBe(204)
    const after = await (await adminGet('/admin/devices/unpaired')).json<UnpairedPage>()
    expect(after.total - before.total).toBe(3)
    expect(after.new24h - before.new24h).toBe(3)
  })

  it('xoá dòng quá 30 ngày ở lần ghi kế tiếp và giữ dòng 29 ngày', async () => {
    const old = crypto.randomUUID()
    const recent = crypto.randomUUID()
    await insertHeartbeat(old, Date.now() - 31 * DAY_MS)
    await insertHeartbeat(recent, Date.now() - 29 * DAY_MS)

    expect((await heartbeat(heartbeatBody())).status).toBe(204)
    expect(await heartbeatRow(old)).toBeNull()
    expect(await heartbeatRow(recent)).not.toBeNull()
  })

  it('trả 413 khi body vượt 2048 byte, kể cả không có content-length', async () => {
    const body = heartbeatBody()
    const text = padTo(JSON.stringify(body), 2049)
    const response = await call('/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: streamOf(text),
    })
    expect(response.status).toBe(413)
    expect(await heartbeatRow(body.installId)).toBeNull()
  })

  it('trả 413 khi content-length khai báo vượt 2048 byte', async () => {
    const body = heartbeatBody()
    const text = padTo(JSON.stringify(body), 2049)
    const response = await call('/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2049' },
      body: text,
    })
    expect(response.status).toBe(413)
    expect(await heartbeatRow(body.installId)).toBeNull()

    const declared = await call('/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '5000' },
      body: padTo(JSON.stringify(heartbeatBody()), 5000),
    })
    expect(declared.status).toBe(413)
  })

  it('nhận body đúng 2048 byte', async () => {
    const body = heartbeatBody()
    const response = await call('/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: padTo(JSON.stringify(body), 2048),
    })
    expect(response.status).toBe(204)
  })

  it('từ chối khoá lạ, debtTotal âm và JSON hỏng bằng 400', async () => {
    const unknownKey = heartbeatBody({ tenKhachHang: 'Nguyễn A' })
    expect((await heartbeat(unknownKey)).status).toBe(400)
    expect(await heartbeatRow(unknownKey.installId)).toBeNull()

    const negative = heartbeatBody({ debtTotal: -1 })
    expect((await heartbeat(negative)).status).toBe(400)
    expect(await heartbeatRow(negative.installId)).toBeNull()

    const broken = await call('/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"installId":',
    })
    expect(broken.status).toBe(400)
  })

  it('trả 429 khi limiter heartbeat hết quota', async () => {
    const body = heartbeatBody()
    const response = await heartbeat(body, { HEARTBEAT_RATE_LIMITER: denyingLimiter() }, {
      'cf-connecting-ip': '203.0.113.9',
    })
    expect(response.status).toBe(429)
    expect(await heartbeatRow(body.installId)).toBeNull()
  })

  it('trả 503 khi D1 lỗi và không lặp lại dữ liệu đã nhận', async () => {
    const body = heartbeatBody()
    const response = await heartbeat(body, { ADMIN_DB: brokenDb() })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(body.installId)
  })
})

describe('chuyển trạng thái khi ghép máy', () => {
  it('heartbeat trước rồi /pair kèm installId thì dòng có pairedShopId', async () => {
    const installId = crypto.randomUUID()
    expect((await heartbeat(heartbeatBody({ installId }))).status).toBe(204)
    const shop = await createShop()

    expect((await pairCode(shop.code, 'A', { installId })).status).toBe(201)
    const row = await heartbeatRow(installId)
    expect(row).toMatchObject({ pairedShopId: shop.shopId })
    expect(row?.pairedAt).toEqual(expect.any(Number))
  })

  it('heartbeat tới sau /pair trong 10 phút không xoá trạng thái đã ghép', async () => {
    const installId = crypto.randomUUID()
    const shop = await createShop()
    expect((await pairCode(shop.code, 'A', { installId })).status).toBe(201)

    expect((await heartbeat(heartbeatBody({ installId }))).status).toBe(204)
    expect(await heartbeatRow(installId)).toMatchObject({ pairedShopId: shop.shopId })
  })

  it('heartbeat sau 10 phút kể từ /pair xoá trạng thái đã ghép', async () => {
    const installId = crypto.randomUUID()
    const shop = await createShop()
    expect((await pairCode(shop.code, 'A', { installId })).status).toBe(201)
    await env.ADMIN_DB.prepare('UPDATE heartbeats SET pairedAt = ? WHERE installId = ?')
      .bind(Date.now() - 11 * MINUTE_MS, installId)
      .run()

    expect((await heartbeat(heartbeatBody({ installId }))).status).toBe(204)
    expect(await heartbeatRow(installId)).toMatchObject({ pairedShopId: null, pairedAt: null })
  })

  it('/pair trước mọi heartbeat tạo dòng với giá trị trung tính', async () => {
    const installId = crypto.randomUUID()
    const shop = await createShop()
    expect((await pairCode(shop.code, 'A', { installId })).status).toBe(201)

    expect(await heartbeatRow(installId)).toMatchObject({
      pairedShopId: shop.shopId,
      shopName: '',
      appVersion: '',
      platform: 'browser',
      orderCount: 0,
      customerCount: 0,
      debtTotal: 0,
    })
  })

  it('/pair không có installId hoặc installId hỏng giữ response cũ và DO nhận đúng năm khoá', async () => {
    const received: Record<string, unknown>[] = []
    const overrides = { SHOP_DO: recordingShopDo(received) }

    const missingShop = await createShop()
    const missing = await pairCode(missingShop.code, 'A', {}, overrides)
    expect(missing.status).toBe(201)
    expect(await missing.json<Paired>()).toMatchObject({ shopId: missingShop.shopId, letter: 'A', token: expect.any(String) })

    const malformedShop = await createShop()
    const malformed = await pairCode(malformedShop.code, 'A', { installId: 'abc' }, overrides)
    expect(malformed.status).toBe(201)

    expect(received).toHaveLength(2)
    for (const body of received) {
      expect(Object.keys(body).sort()).toEqual(['hasLocalLedger', 'label', 'letter', 'localLedgerRows', 'secret'])
    }
  })

  it('/pair với installId hỏng không tạo dòng heartbeat', async () => {
    const shop = await createShop()
    expect((await pairCode(shop.code, 'A', { installId: 'abc' })).status).toBe(201)
    expect(await heartbeatRow('abc')).toBeNull()
  })

  it('/pair vẫn trả 201 khi D1 lỗi', async () => {
    const installId = crypto.randomUUID()
    const shop = await createShop()
    const response = await pairCode(shop.code, 'A', { installId }, { ADMIN_DB: brokenDb() })
    expect(response.status).toBe(201)
  })
})

describe('lượt chạm sổ ở /epoch', () => {
  it('/epoch của máy đã ghép đưa sổ thiếu trong D1 vào chỉ mục với via touch', async () => {
    const { shopId, device } = await pairedShop()
    await deleteShopRow(shopId)
    const before = Date.now()

    expect((await claimEpoch(shopId, device.token)).status).toBe(200)
    const row = await shopRow(shopId)
    expect(row).toMatchObject({ shopId, via: 'touch' })
    expect(row?.createdAt).toBe(row?.indexedAt)
    expect(row?.createdAt).toBeGreaterThanOrEqual(before)
    expect(row?.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('/epoch với token sai không ghi chỉ mục', async () => {
    const shopId = (await createShop()).shopId
    await deleteShopRow(shopId)

    expect((await claimEpoch(shopId, 'token-sai')).status).toBe(401)
    expect(await shopRow(shopId)).toBeNull()
  })

  it('cùng một isolate chỉ ghi lượt chạm một lần cho mỗi sổ', async () => {
    const { shopId, device } = await pairedShop()
    await deleteShopRow(shopId)
    expect((await claimEpoch(shopId, device.token)).status).toBe(200)
    expect(await shopRow(shopId)).toMatchObject({ via: 'touch' })

    await deleteShopRow(shopId)
    expect((await claimEpoch(shopId, device.token, 2)).status).toBe(200)
    expect(await shopRow(shopId)).toBeNull()
  })
})

describe('D1 chậm không giữ phản hồi', () => {
  it('POST /shop trả 201 trước khi ghi chỉ mục xong', async () => {
    expect(await statusWhileD1Hangs('/shop', { method: 'POST', headers: bearer(adminSecret) })).toBe(201)
  })

  it('/pair kèm installId trả 201 trước khi đánh dấu dòng heartbeat xong', async () => {
    const shop = await createShop()
    const init = jsonRequest('POST', {
      code: shop.code,
      letter: 'A',
      label: 'Máy A',
      hasLocalLedger: false,
      localLedgerRows: 0,
      installId: crypto.randomUUID(),
    })
    expect(await statusWhileD1Hangs('/pair', init)).toBe(201)
  })

  it('/epoch trả 200 trước khi ghi lượt chạm xong', async () => {
    const { shopId, device } = await pairedShop()
    const init = jsonRequest('POST', { epoch: 1 }, bearer(device.token))
    expect(await statusWhileD1Hangs(`/shop/${shopId}/epoch`, init)).toBe(200)
  })
})

describe('chỉ mục khi tạo quán', () => {
  it('POST /shop ghi via create với createdAt và indexedAt trong khoảng trước và sau lời gọi', async () => {
    const before = Date.now()
    const shop = await createShop()
    const after = Date.now()

    const row = await shopRow(shop.shopId)
    expect(row).toMatchObject({ shopId: shop.shopId, via: 'create' })
    expect(row?.createdAt).toBeGreaterThanOrEqual(before)
    expect(row?.createdAt).toBeLessThanOrEqual(after)
    expect(row?.indexedAt).toBe(row?.createdAt)
  })

  it('POST /shop vẫn trả 201 khi D1 lỗi và ghi log admin-index-failed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await call('/shop', { method: 'POST', headers: bearer(adminSecret) }, { ADMIN_DB: brokenDb() })
    expect(response.status).toBe(201)
    expect(errors.mock.calls.some(([message]) => message === 'admin-index-failed')).toBe(true)
  })
})

describe('tuyến cũ không đổi', () => {
  it('GET /health, POST /shop không bearer và sổ không tồn tại vẫn giữ hành vi cũ', async () => {
    const health = await call('/health')
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toEqual({ status: 'ok' })

    expect((await call('/shop', { method: 'POST' })).status).toBe(401)
    expect((await call(`/shop/${crypto.randomUUID()}/devices`, { headers: bearer('khong-co') })).status).toBe(404)
    expect((await call('/shop/zz/devices', { headers: bearer('khong-co') })).status).toBe(404)
  })

  it('OPTIONS /shop vẫn trả 204 với CORS', async () => {
    const response = await call('/shop', { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('tự phục hồi khi bảng shops mất', () => {
  it('POST /shop vẫn ghi chỉ mục sau khi bảng shops bị xoá giữa chừng', async () => {
    await env.ADMIN_DB.prepare('DROP TABLE IF EXISTS shops').run()

    const shop = await createShop()
    expect(await shopRow(shop.shopId)).toMatchObject({ shopId: shop.shopId, via: 'create' })
  })
})
