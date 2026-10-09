import {
  ADMIN_SHOPS_MAX_LIMIT,
  HEARTBEAT_MAX_BYTES,
  HeartbeatSchema,
  RECONCILE_MAX_IDS,
  type AdminShopsPage,
  type HeartbeatRecord,
  type ReconcileResult,
  type ShopIndexVia,
  type ShopOverview,
  type UnpairedPage,
} from '../../shared/admin-contract'
import { touchedShops, withAdminDb } from './admin-db'
import { bearerToken, parseRoutedPairCode, secretsEqual } from './auth'
import type { Env } from './env'

const DAY_MS = 24 * 60 * 60 * 1000
const HEARTBEAT_RETENTION_MS = 30 * DAY_MS
const ADMIN_DO_CONCURRENCY = 6
const SHOP_ID_PATTERN = /^[0-9a-f-]{36}$/i
const DO_ID_PATTERN = /^[0-9a-f]{64}$/

const INSERT_SHOP_SQL = 'INSERT OR IGNORE INTO shops (shopId, createdAt, via, indexedAt) VALUES (?, ?, ?, ?)'

/**
 * Cập nhật chỉ khi có gì đổi hoặc đã quá 15 phút, để nhịp báo lặp lại không tốn hàng ghi D1. Trạng thái đã ghép
 * giữ trong 10 phút sau `/pair`: nhịp báo gửi trước khi ghép mà tới muộn không được xoá nó.
 */
const UPSERT_HEARTBEAT_SQL = `INSERT INTO heartbeats (installId, shopName, appVersion, platform, orderCount, customerCount,
  debtTotal, firstSeenAt, lastSeenAt, pairedShopId, pairedAt)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, NULL, NULL)
ON CONFLICT(installId) DO UPDATE SET shopName = excluded.shopName, appVersion = excluded.appVersion,
  platform = excluded.platform, orderCount = excluded.orderCount, customerCount = excluded.customerCount,
  debtTotal = excluded.debtTotal, lastSeenAt = excluded.lastSeenAt,
  pairedShopId = CASE WHEN heartbeats.pairedAt IS NOT NULL AND excluded.lastSeenAt - heartbeats.pairedAt <= 600000
    THEN heartbeats.pairedShopId ELSE NULL END,
  pairedAt = CASE WHEN heartbeats.pairedAt IS NOT NULL AND excluded.lastSeenAt - heartbeats.pairedAt <= 600000
    THEN heartbeats.pairedAt ELSE NULL END
WHERE heartbeats.shopName IS NOT excluded.shopName OR heartbeats.appVersion IS NOT excluded.appVersion
  OR heartbeats.platform IS NOT excluded.platform OR heartbeats.orderCount IS NOT excluded.orderCount
  OR heartbeats.customerCount IS NOT excluded.customerCount OR heartbeats.debtTotal IS NOT excluded.debtTotal
  OR excluded.lastSeenAt - heartbeats.lastSeenAt >= 900000
  OR (heartbeats.pairedShopId IS NOT NULL AND excluded.lastSeenAt - heartbeats.pairedAt > 600000)`

/** Máy ghép trước khi từng gửi nhịp báo vẫn có dòng, với giá trị trung tính cho tới nhịp báo đầu tiên. */
const MARK_PAIRED_SQL = `INSERT INTO heartbeats (installId, shopName, appVersion, platform, orderCount, customerCount,
  debtTotal, firstSeenAt, lastSeenAt, pairedShopId, pairedAt)
VALUES (?1, '', '', 'browser', 0, 0, 0, ?3, ?3, ?2, ?3)
ON CONFLICT(installId) DO UPDATE SET pairedShopId = excluded.pairedShopId, pairedAt = excluded.pairedAt`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function withCors(response: Response): Response {
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function forward(stub: DurableObjectStub, request: Request, path: string, body?: unknown): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  const init: RequestInit = { method: request.method, headers }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(body)
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }
  return stub.fetch(new Request(`https://shop.internal${path}`, init))
}

function shopStub(env: Env, shopId: string): DurableObjectStub {
  return env.SHOP_DO.get(env.SHOP_DO.idFromName(shopId))
}

async function attemptAllowed(request: Request, limiter: RateLimit, scope: string): Promise<boolean> {
  const actor = request.headers.get('cf-connecting-ip')
  if (!actor) return true
  return (await limiter.limit({ key: `${scope}:${actor}` })).success
}

async function adminAuthorized(request: Request, env: Env): Promise<boolean> {
  return Boolean(env.ADMIN_SECRET) && secretsEqual(bearerToken(request) ?? '', env.ADMIN_SECRET)
}

/** Khu xem khoá hẳn khi secret xem thiếu, ngắn tới mức đoán được, hoặc trùng secret tạo quán. */
async function viewAuthorized(request: Request, env: Env): Promise<boolean> {
  const view = env.ADMIN_VIEW_SECRET
  if (!view || view.length < 32 || (await secretsEqual(view, env.ADMIN_SECRET ?? ''))) return false
  return secretsEqual(bearerToken(request) ?? '', view)
}

function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function invalidRequest(): Response {
  return Response.json({ error: 'invalid-request' }, { status: 400 })
}

async function mapLimited<T, R>(items: readonly T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane))
  return results
}

/** Gọi đường nội bộ của DO bằng request mới, không mang theo header nào của người gọi (nhất là `authorization`). */
function internalAdmin(stub: DurableObjectStub, path: string): Promise<Response> {
  return stub.fetch(new Request(`https://shop.internal/internal/admin${path}`))
}

async function indexShop(env: Env, shopId: string, via: 'create' | 'touch'): Promise<void> {
  const now = Date.now()
  await withAdminDb(env, (db) => db.prepare(INSERT_SHOP_SQL).bind(shopId, now, via, now).run())
}

async function listShops(url: URL, env: Env): Promise<Response> {
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? ADMIN_SHOPS_MAX_LIMIT : /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : 0
  if (limit < 1 || limit > ADMIN_SHOPS_MAX_LIMIT) return invalidRequest()
  const cursor = url.searchParams.get('cursor') ?? ''

  const { results } = await withAdminDb(env, (db) =>
    db.prepare('SELECT shopId, createdAt, via FROM shops WHERE shopId > ? ORDER BY shopId LIMIT ?')
      .bind(cursor, limit)
      .all<{ shopId: string; createdAt: number; via: ShopIndexVia }>(),
  )
  const shops = await mapLimited(results, ADMIN_DO_CONCURRENCY, async (row): Promise<AdminShopsPage['shops'][number]> => {
    try {
      const response = await internalAdmin(shopStub(env, row.shopId), '/overview')
      if (!response.ok) return { shopId: row.shopId, error: `HTTP ${response.status}` }
      return { ...(await response.json<ShopOverview>()), via: row.via }
    } catch {
      return { shopId: row.shopId, error: 'unreachable' }
    }
  })
  const page: AdminShopsPage = {
    shops,
    next: results.length === limit ? (results[results.length - 1]?.shopId ?? null) : null,
  }
  return Response.json(page)
}

async function listUnpairedDevices(env: Env): Promise<Response> {
  const now = Date.now()
  const since = now - HEARTBEAT_RETENTION_MS
  const [devices, total, fresh] = await withAdminDb(env, (db) =>
    db.batch<Record<string, unknown>>([
      db.prepare(
        'SELECT installId, shopName, appVersion, platform, orderCount, customerCount, debtTotal, firstSeenAt, lastSeenAt, pairedShopId, pairedAt FROM heartbeats WHERE lastSeenAt >= ? ORDER BY lastSeenAt DESC LIMIT 500',
      ).bind(since),
      db.prepare('SELECT COUNT(*) AS total FROM heartbeats WHERE lastSeenAt >= ?').bind(since),
      db.prepare('SELECT COUNT(*) AS new24h FROM heartbeats WHERE firstSeenAt >= ?').bind(now - DAY_MS),
    ]),
  )
  const page: UnpairedPage = {
    // Cột đọc ra đúng tên và kiểu của bảng `heartbeats`, mà mọi dòng ghi vào đều đã qua HeartbeatSchema.
    devices: (devices?.results ?? []) as HeartbeatRecord[],
    total: Number(total?.results[0]?.total) || 0,
    new24h: Number(fresh?.results[0]?.new24h) || 0,
  }
  return Response.json(page)
}

async function readShopView(url: URL, env: Env, shopId: string, data: boolean): Promise<Response> {
  if (!SHOP_ID_PATTERN.test(shopId)) return notFound()
  const stub = shopStub(env, shopId)
  if (!data) return internalAdmin(stub, '/overview?debts=1')

  const query = new URLSearchParams()
  for (const key of ['table', 'after', 'limit', 'orderIds']) {
    const value = url.searchParams.get(key)
    if (value !== null) query.set(key, value)
  }
  return internalAdmin(stub, `/data?${query}`)
}

async function handleAdminView(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== 'GET') return notFound()
  if (!(await viewAuthorized(request, env))) {
    if (!(await attemptAllowed(request, env.PAIR_RATE_LIMITER, 'admin'))) {
      return Response.json({ error: 'rate-limited' }, { status: 429 })
    }
    return unauthorized()
  }

  if (url.pathname === '/admin/shops') return listShops(url, env)
  if (url.pathname === '/admin/devices/unpaired') return listUnpairedDevices(env)
  const shop = url.pathname.match(/^\/admin\/shops\/([^/]+)(\/data)?$/)
  if (shop?.[1]) return readShopView(url, env, decodeURIComponent(shop[1]), shop[2] === '/data')
  return notFound()
}

type ReconcileOutcome =
  | { kind: 'found'; shopId: string; createdAt: number }
  | { kind: 'skipped'; skip: ReconcileResult['skipped'][number] }

async function identifyShop(env: Env, id: string): Promise<ReconcileOutcome> {
  let doId: DurableObjectId
  try {
    doId = env.SHOP_DO.idFromString(id)
  } catch {
    return { kind: 'skipped', skip: { id, reason: 'invalid-id' } }
  }
  const response = await internalAdmin(env.SHOP_DO.get(doId), '/identity')
  if (response.status === 404) return { kind: 'skipped', skip: { id, reason: 'not-initialized' } }
  if (!response.ok) throw new Error(`identity HTTP ${response.status}`)

  const identity = await response.json<{ shopId?: unknown; createdAt?: unknown }>()
  if (typeof identity.shopId !== 'string' || typeof identity.createdAt !== 'number') {
    throw new Error('identity không đúng dạng')
  }
  // Chỉ nhận shopId mà DO tự khai và băm lại đúng id được gửi: không ai ghi được shopId giả vào chỉ mục.
  if (env.SHOP_DO.idFromName(identity.shopId).toString() !== id) {
    return { kind: 'skipped', skip: { id, reason: 'id-mismatch' } }
  }
  return { kind: 'found', shopId: identity.shopId, createdAt: identity.createdAt }
}

async function reconcileIndex(request: Request, env: Env): Promise<Response> {
  if (!(await adminAuthorized(request, env))) return unauthorized()

  const ids = (await readJson(request))?.ids
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > RECONCILE_MAX_IDS ||
    !ids.every((id): id is string => typeof id === 'string' && DO_ID_PATTERN.test(id))
  ) {
    return invalidRequest()
  }

  const outcomes = await mapLimited(ids, ADMIN_DO_CONCURRENCY, (id) => identifyShop(env, id))
  const result: ReconcileResult = { registered: 0, alreadyIndexed: 0, skipped: [] }
  const found: { shopId: string; createdAt: number }[] = []
  for (const outcome of outcomes) {
    if (outcome.kind === 'skipped') result.skipped.push(outcome.skip)
    else found.push(outcome)
  }

  if (found.length > 0) {
    const now = Date.now()
    const written = await withAdminDb(env, (db) => {
      const insert = db.prepare(INSERT_SHOP_SQL)
      return db.batch(found.map((shop) => insert.bind(shop.shopId, shop.createdAt, 'backfill', now)))
    })
    for (const row of written) {
      if (row.meta.changes === 1) result.registered += 1
      else result.alreadyIndexed += 1
    }
  }
  return Response.json(result)
}

async function handleAdmin(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    if (request.method === 'POST' && url.pathname === '/admin/index/reconcile') return await reconcileIndex(request, env)
    return await handleAdminView(request, url, env)
  } catch {
    // Không kèm chi tiết lỗi: thông điệp D1 hay DO có thể chứa shopId.
    console.error('admin-request-failed')
    return Response.json({ error: 'admin-unavailable' }, { status: 503 })
  }
}

async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function acceptHeartbeat(request: Request, env: Env): Promise<Response> {
  if (!(await attemptAllowed(request, env.HEARTBEAT_RATE_LIMITER, 'hb'))) {
    return Response.json({ error: 'rate-limited' }, { status: 429 })
  }
  const tooLarge = () => Response.json({ error: 'too-large' }, { status: 413 })
  if (Number(request.headers.get('content-length') ?? 0) > HEARTBEAT_MAX_BYTES) return tooLarge()
  const bytes = await readCappedBody(request, HEARTBEAT_MAX_BYTES)
  if (!bytes) return tooLarge()

  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    return invalidRequest()
  }
  const parsed = HeartbeatSchema.safeParse(raw)
  if (!parsed.success) return invalidRequest()

  const beat = parsed.data
  const now = Date.now()
  try {
    await withAdminDb(env, (db) =>
      db.batch([
        db.prepare('DELETE FROM heartbeats WHERE lastSeenAt < ?').bind(now - HEARTBEAT_RETENTION_MS),
        db.prepare(UPSERT_HEARTBEAT_SQL).bind(
          beat.installId,
          beat.shopName,
          beat.appVersion,
          beat.platform,
          beat.orderCount,
          beat.customerCount,
          beat.debtTotal,
          now,
        ),
      ]),
    )
  } catch {
    console.error('heartbeat-store-failed')
    return Response.json({ error: 'unavailable' }, { status: 503 })
  }
  return new Response(null, { status: 204 })
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })

    let response: Response
    if (request.method === 'GET' && url.pathname === '/health') {
      response = Response.json({ status: 'ok' })
    } else if (request.method === 'POST' && url.pathname === '/shop') {
      const authorization = request.headers.get('authorization')
      const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      if (!env.ADMIN_SECRET || !(await secretsEqual(supplied, env.ADMIN_SECRET))) {
        response = Response.json({ error: 'unauthorized' }, { status: 401 })
      } else {
        const shopId = crypto.randomUUID()
        response = await forward(shopStub(env, shopId), request, '/internal/bootstrap', { shopId })
        if (response.status === 201) {
          try {
            await indexShop(env, shopId, 'create')
          } catch {
            // Quán đã tạo xong; sổ thiếu trong chỉ mục sẽ vào lại qua điền bù hoặc lượt chạm `/epoch`.
            console.error('admin-index-failed')
          }
        }
      }
    } else if (request.method === 'POST' && url.pathname === '/heartbeat') {
      response = await acceptHeartbeat(request, env)
    } else if (url.pathname.startsWith('/admin/')) {
      response = await handleAdmin(request, url, env)
    } else if (request.method === 'POST' && url.pathname === '/pair') {
      if (!(await attemptAllowed(request, env.PAIR_RATE_LIMITER, 'pair'))) {
        response = Response.json(
          { error: 'rate-limited', message: 'Thử ghép quá nhiều lần. Chờ một phút rồi thử lại.' },
          { status: 429 },
        )
      } else {
        const body = await readJson(request)
        const routed = typeof body?.code === 'string' ? parseRoutedPairCode(body.code.trim()) : null
        if (!routed) {
          response = Response.json(
            { error: 'pair-invalid', message: 'Mã ghép không đúng, đã dùng hoặc đã hết hạn.' },
            { status: 401 },
          )
        } else {
          response = await forward(shopStub(env, routed.shopId), request, '/pair', {
            secret: routed.secret,
            label: body?.label,
            letter: body?.letter,
            hasLocalLedger: body?.hasLocalLedger,
            localLedgerRows: body?.localLedgerRows,
          })
          const installId = HeartbeatSchema.shape.installId.safeParse(body?.installId)
          if (response.status === 201 && installId.success) {
            try {
              const now = Date.now()
              await withAdminDb(env, (db) =>
                db.prepare(MARK_PAIRED_SQL).bind(installId.data, routed.shopId, now).run(),
              )
            } catch {
              // Máy đã ghép xong; dòng nhịp báo chỉ lệch tới nhịp báo kế tiếp.
              console.error('admin-pair-mark-failed')
            }
          }
        }
      }
    } else {
      const matched = url.pathname.match(/^\/shop\/([^/]+)(\/.*)$/)
      const shopId = matched?.[1] ? decodeURIComponent(matched[1]) : ''
      const rest = matched?.[2] ?? ''
      const safeShopId = /^[0-9a-f-]{36}$/i.test(shopId)
      const allowed =
        (request.method === 'POST' && rest === '/pair-code') ||
        (request.method === 'GET' && rest === '/devices') ||
        (request.method === 'GET' && rest === '/ws') ||
        (request.method === 'POST' && rest === '/epoch') ||
        (request.method === 'POST' && rest === '/events') ||
        (request.method === 'POST' && rest === '/seed') ||
        (request.method === 'GET' && rest === '/oplog') ||
        (request.method === 'POST' && /^\/devices\/[^/]+\/revoke$/.test(rest))

      response = safeShopId && allowed
        // Giữ query string: `/oplog?since=N` mà rơi `since` là mọi trang đều trở về seq 1..500.
        ? await forward(shopStub(env, shopId), request, rest + url.search)
        : new Response('Not found', { status: 404 })

      // Sổ ngủ có thể thiếu trong danh sách DO của Cloudflare; máy đã ghép chạm `/epoch` thì đưa sổ vào chỉ mục.
      if (request.method === 'POST' && rest === '/epoch' && response.ok && !touchedShops.has(shopId)) {
        try {
          await indexShop(env, shopId, 'touch')
          touchedShops.add(shopId)
        } catch {
          console.error('admin-index-failed')
        }
      }
    }

    return withCors(response)
  },
} satisfies ExportedHandler<Env>

export { ShopDO } from './shop-do'
export default worker
