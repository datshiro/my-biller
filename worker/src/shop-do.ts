import { DurableObject } from 'cloudflare:workers'
import {
  bearerToken,
  generatePairSecret,
  generateToken,
  hashSecret,
  routedPairCode,
} from './auth'
import type { Env } from './env'
import { SyncEventSchema, type SyncEvent } from '../../shared/sync-events'
import { LedgerTableSchema, safeParseLedgerPayload } from '../../shared/ledger-schemas'
import { summarizeServerLedger } from '../../shared/ledger-money'
import type { AdminDataPage, DeviceOverview, ShopDebt, ShopDetail, ShopOverview } from '../../shared/admin-contract'
import { itemNameKey } from '../../shared/item-name'
import {
  CatalogEventSchema,
  CatalogTableSchema,
  safeParseCatalogPayload,
  type CatalogEvent,
} from '../../shared/catalog-events'

const INITIALIZED_KEY = 'initialized'
const PAIR_TTL_MS = 5 * 60 * 1000
const PAIR_ADMISSION_TTL_MS = 2 * 60 * 1000
const PAIR_FAILURE_LIMIT = 8
const PAIR_LOCK_MS = 5 * 60 * 1000
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000
const ADMIN_DATA_MAX_LIMIT = 200
const ADMIN_ORDER_IDS_MAX = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DeviceRow = {
  id: string
  letter: string
  label: string
  tokenHash: string
  createdAt: number
  revokedAt: number | null
}

type PairCodeRow = {
  codeHash: string
  expiresAt: number
  usedAt: number | null
}

type LedgerRow = { payload: string }
type LedgerAdmissionRow = {
  deviceId: string
  codeHash: string
  expectedRows: number
  expiresAt: number
}

class SeedRejected extends Error {}

const REFERENCE_FIELDS: Record<SyncEvent['table'], readonly string[]> = {
  settings: [],
  itemGroups: [],
  items: ['groupId'],
  customers: [],
  customerPrices: ['customerId', 'itemId'],
  orders: ['customerId'],
  orderLines: ['orderId', 'itemId'],
  payments: ['orderId', 'allocatedOrderId', 'customerId'],
  expenseCategories: [],
  expenses: ['categoryId'],
}

const REQUIRED_REFERENCES = new Set(['customerPrices.customerId', 'customerPrices.itemId', 'orderLines.orderId', 'payments.orderId'])
const LOCAL_FOREIGN_KEYS = new Set(Object.values(REFERENCE_FIELDS).flat())
const SETTINGS_KEYS = new Set(['shop', 'app'])
/** Máy khai báo khả năng này hiểu luồng danh mục; luật mới về nhóm lựa chọn chỉ từ chối máy đó, không bao giờ máy cũ. */
const CATALOG_V2 = 'catalog-v2'

const CATALOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS catalogOplog (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId TEXT NOT NULL UNIQUE,
    entityKey TEXT NOT NULL,
    tableName TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    serverAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalogLedger (
    tableName TEXT NOT NULL,
    entityKey TEXT NOT NULL,
    payload TEXT NOT NULL,
    updatedSeq INTEGER NOT NULL,
    PRIMARY KEY (tableName, entityKey)
  );
`

const json = (body: unknown, status = 200) => Response.json(body, { status })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function first<T>(rows: Iterable<T>): T | undefined {
  return rows[Symbol.iterator]().next().value as T | undefined
}

function nonNegativeInteger(raw: string | null): number | null {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
}

function parseAfterRefs(payload: string): { after: unknown; refs: unknown } {
  const parsed = JSON.parse(payload) as { after?: unknown; refs?: unknown }
  return { after: parsed.after ?? null, refs: parsed.refs ?? {} }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export class ShopDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  private adminSchemaReady = false
  private catalogSchemaReady = false
  /** Máy đã kéo lùi trong cửa sổ không ghi; lần ghi kế tiếp phải đặt `rewoundAt`. */
  private readonly pendingRewind = new Set<string>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  private async isInitialized(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(INITIALIZED_KEY)) === true
  }

  private initializeSchema(shopId: string, codeHash: string, expiresAt: number): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS shop (
          id TEXT PRIMARY KEY,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          letter TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          tokenHash TEXT NOT NULL UNIQUE,
          createdAt INTEGER NOT NULL,
          revokedAt INTEGER
        );
        CREATE TABLE IF NOT EXISTS pairCodes (
          codeHash TEXT PRIMARY KEY,
          expiresAt INTEGER NOT NULL,
          usedAt INTEGER,
          createdAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pairGuard (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          failures INTEGER NOT NULL,
          lockedUntil INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS deviceEpochs (
          deviceId TEXT PRIMARY KEY,
          epoch INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oplog (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          eventId TEXT NOT NULL UNIQUE,
          entityKey TEXT NOT NULL,
          tableName TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          deviceId TEXT NOT NULL,
          serverAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ledger (
          tableName TEXT NOT NULL,
          entityKey TEXT NOT NULL,
          payload TEXT NOT NULL,
          updatedSeq INTEGER NOT NULL,
          PRIMARY KEY (tableName, entityKey)
        );
        CREATE TABLE IF NOT EXISTS ledgerAdmission (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          deviceId TEXT NOT NULL,
          codeHash TEXT NOT NULL,
          expectedRows INTEGER NOT NULL CHECK (expectedRows >= 0),
          expiresAt INTEGER NOT NULL
        );
      ` + CATALOG_SCHEMA)
      const now = Date.now()
      this.sql.exec('INSERT OR IGNORE INTO shop (id, createdAt) VALUES (?, ?)', shopId, now)
      this.sql.exec(
        'INSERT OR IGNORE INTO pairGuard (singleton, failures, lockedUntil) VALUES (1, 0, 0)',
      )
      this.sql.exec(
        'INSERT INTO pairCodes (codeHash, expiresAt, usedAt, createdAt) VALUES (?, ?, NULL, ?)',
        codeHash,
        expiresAt,
        now,
      )
    })
  }

  /**
   * Sổ tạo trước khi có khu admin không bao giờ chạy lại `initializeSchema`, nên phần schema này được bù ở
   * request đầu của mỗi instance. Hỏng ở đây chỉ làm mất số liệu admin, không được chặn đồng bộ.
   */
  private ensureAdminSchema(): void {
    if (this.adminSchemaReady) return
    try {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS deviceActivity (
          deviceId TEXT PRIMARY KEY,
          lastSeenAt INTEGER NOT NULL,
          pulledSeq INTEGER NOT NULL,
          rewoundAt INTEGER
        );
        CREATE INDEX IF NOT EXISTS ledger_seq ON ledger(tableName, updatedSeq);
      `)
      this.adminSchemaReady = true
    } catch (error) {
      this.adminSchemaReady = false
      console.error('admin-schema-failed', error)
    }
  }

  /**
   * Sổ tạo trước khi có luồng danh mục không chạy lại `initializeSchema`. Khác phần admin: lỗi ở đây phải làm hỏng
   * request, vì đi tiếp là nhận/ghép sổ mà thiếu bảng danh mục.
   */
  private ensureCatalogSchema(): void {
    if (this.catalogSchemaReady) return
    this.sql.exec(CATALOG_SCHEMA)
    this.catalogSchemaReady = true
  }

  /**
   * Ghi `since` báo gần nhất, tối đa một lần mỗi phút mỗi máy kể cả khi máy tiến tới, để quota ghi của DO không
   * tăng theo nhịp kéo. Không lấy max: số nhỏ hơn nghĩa là máy đã kéo lại từ đầu.
   */
  private recordPullProgress(deviceId: string, since: number): void {
    try {
      const now = Date.now()
      const row = first(
        this.sql.exec<{ lastSeenAt: number; pulledSeq: number; rewoundAt: number | null }>(
          'SELECT lastSeenAt, pulledSeq, rewoundAt FROM deviceActivity WHERE deviceId = ?',
          deviceId,
        ),
      )
      if (!row) {
        this.sql.exec(
          'INSERT INTO deviceActivity (deviceId, lastSeenAt, pulledSeq, rewoundAt) VALUES (?, ?, ?, NULL)',
          deviceId,
          now,
          since,
        )
        return
      }
      const rewound = since < row.pulledSeq
      if (now - row.lastSeenAt < ACTIVITY_WRITE_INTERVAL_MS) {
        if (rewound) this.pendingRewind.add(deviceId)
        return
      }
      const pending = this.pendingRewind.delete(deviceId)
      this.sql.exec(
        'UPDATE deviceActivity SET lastSeenAt = ?, pulledSeq = ?, rewoundAt = ? WHERE deviceId = ?',
        now,
        since,
        rewound || pending ? now : row.rewoundAt,
        deviceId,
      )
    } catch (error) {
      this.adminSchemaReady = false
      console.error('admin-activity-failed', error)
    }
  }

  private shopId(): string {
    const row = first(this.sql.exec<{ id: string }>('SELECT id FROM shop LIMIT 1'))
    if (!row) throw new Error('Shop chưa được khởi tạo.')
    return row.id
  }

  private async requestTokenHash(request: Request): Promise<string | null> {
    const protocols = request.headers
      .get('sec-websocket-protocol')
      ?.split(',')
      .map((value) => value.trim())
    const token = bearerToken(request) ?? (protocols?.[0] === 'my-biller' ? protocols[1] ?? null : null)
    if (!token) return null
    return hashSecret(token)
  }

  private activeDeviceByTokenHash(tokenHash: string, allowPending = false): DeviceRow | null {
    const device = first(
      this.sql.exec<DeviceRow>(
        'SELECT id, letter, label, tokenHash, createdAt, revokedAt FROM devices WHERE tokenHash = ? AND revokedAt IS NULL LIMIT 1',
        tokenHash,
      ),
    )
    if (!device) return null
    const pending = first(
      this.sql.exec<{ deviceId: string }>(
        'SELECT deviceId FROM ledgerAdmission WHERE deviceId = ? LIMIT 1',
        device.id,
      ),
    )
    return allowPending || !pending ? device : null
  }

  private async authenticate(request: Request, allowPending = false): Promise<DeviceRow | null> {
    const tokenHash = await this.requestTokenHash(request)
    return tokenHash ? this.activeDeviceByTokenHash(tokenHash, allowPending) : null
  }

  private async bootstrap(request: Request): Promise<Response> {
    if (await this.isInitialized()) return json({ error: 'shop-exists' }, 409)
    const body = await readJson(request)
    const shopId = typeof body?.shopId === 'string' ? body.shopId : ''
    if (!/^[0-9a-f-]{36}$/i.test(shopId)) return json({ error: 'invalid-request' }, 400)

    const secret = generatePairSecret()
    const codeHash = await hashSecret(secret)
    const expiresAt = Date.now() + PAIR_TTL_MS
    this.initializeSchema(shopId, codeHash, expiresAt)
    await this.ctx.storage.put(INITIALIZED_KEY, true)
    return json({ shopId, code: routedPairCode(shopId, secret), expiresAt }, 201)
  }

  private pairInvalid(): Response {
    return json(
      { error: 'pair-invalid', message: 'Mã ghép không đúng, đã dùng hoặc đã hết hạn.' },
      401,
    )
  }

  private expireLedgerAdmission(now: number): void {
    const admission = first(
      this.sql.exec<LedgerAdmissionRow>(
        'SELECT deviceId, codeHash, expectedRows, expiresAt FROM ledgerAdmission LIMIT 1',
      ),
    )
    if (!admission || admission.expiresAt > now) return
    this.sql.exec('DELETE FROM devices WHERE id = ?', admission.deviceId)
    this.sql.exec('DELETE FROM ledgerAdmission WHERE deviceId = ?', admission.deviceId)
  }

  private registerPairFailure(now: number): void {
    const guard = first(
      this.sql.exec<{ failures: number; lockedUntil: number }>(
        'SELECT failures, lockedUntil FROM pairGuard WHERE singleton = 1',
      ),
    ) ?? { failures: 0, lockedUntil: 0 }
    const failures = guard.lockedUntil > now ? guard.failures : guard.failures + 1
    const lockedUntil = failures >= PAIR_FAILURE_LIMIT ? now + PAIR_LOCK_MS : guard.lockedUntil
    this.sql.exec(
      'UPDATE pairGuard SET failures = ?, lockedUntil = ? WHERE singleton = 1',
      failures,
      lockedUntil,
    )
  }

  private async pair(request: Request): Promise<Response> {
    const body = await readJson(request)
    const secret = typeof body?.secret === 'string' ? body.secret.trim().toUpperCase() : ''
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    const letter = typeof body?.letter === 'string' ? body.letter.trim().toUpperCase() : ''
    const hasLocalLedger = body?.hasLocalLedger === true
    const localLedgerRows =
      typeof body?.localLedgerRows === 'number' && Number.isInteger(body.localLedgerRows)
        ? body.localLedgerRows
        : -1
    if (
      !secret ||
      !label ||
      !/^[A-Z]$/.test(letter) ||
      typeof body?.hasLocalLedger !== 'boolean' ||
      localLedgerRows < 0 ||
      hasLocalLedger !== (localLedgerRows > 0)
    ) {
      return this.pairInvalid()
    }

    const now = Date.now()
    const codeHash = await hashSecret(secret)
    const token = generateToken()
    const tokenHash = await hashSecret(token)
    const deviceId = crypto.randomUUID()

    const outcome = this.ctx.storage.transactionSync<
      'ok' | 'invalid' | 'letter-conflict' | 'merge-required' | 'seed-in-progress'
    >(() => {
      this.expireLedgerAdmission(now)
      const guard = first(
        this.sql.exec<{ failures: number; lockedUntil: number }>(
          'SELECT failures, lockedUntil FROM pairGuard WHERE singleton = 1',
        ),
      )
      if (!guard || guard.lockedUntil > now) return 'invalid'

      const code = first(
        this.sql.exec<PairCodeRow>(
          'SELECT codeHash, expiresAt, usedAt FROM pairCodes WHERE codeHash = ? LIMIT 1',
          codeHash,
        ),
      )
      if (!code || code.usedAt !== null || code.expiresAt <= now) {
        this.registerPairFailure(now)
        return 'invalid'
      }

      const serverHasLedger = this.countLedgerRows() > 0
      if (
        first(
          this.sql.exec<LedgerAdmissionRow>(
            'SELECT deviceId, codeHash, expectedRows, expiresAt FROM ledgerAdmission LIMIT 1',
          ),
        )
      ) {
        return 'seed-in-progress'
      }
      if (hasLocalLedger && serverHasLedger) return 'merge-required'

      const conflict = first(
        this.sql.exec<{ id: string }>('SELECT id FROM devices WHERE letter = ? LIMIT 1', letter),
      )
      if (conflict) {
        return 'letter-conflict'
      }

      this.sql.exec(
        'INSERT INTO devices (id, letter, label, tokenHash, createdAt, revokedAt) VALUES (?, ?, ?, ?, ?, NULL)',
        deviceId,
        letter,
        label,
        tokenHash,
        now,
      )
      this.sql.exec(
        'INSERT INTO ledgerAdmission (singleton, deviceId, codeHash, expectedRows, expiresAt) VALUES (1, ?, ?, ?, ?)',
        deviceId,
        codeHash,
        localLedgerRows,
        now + PAIR_ADMISSION_TTL_MS,
      )
      this.sql.exec('UPDATE pairGuard SET failures = 0, lockedUntil = 0 WHERE singleton = 1')
      return 'ok'
    })

    if (outcome === 'letter-conflict') {
      return json(
        { error: 'letter-conflict', message: `Chữ ${letter} đã được một máy khác dùng.` },
        409,
      )
    }
    if (outcome === 'merge-required') {
      return json(
        {
          error: 'merge-required',
          message:
            'Máy này và sổ chung đều đã có dữ liệu. Hãy đối soát hai sổ trước khi ghép để không tạo dòng trùng.',
        },
        409,
      )
    }
    if (outcome === 'seed-in-progress') {
      return json(
        {
          error: 'seed-in-progress',
          message: 'Một máy đang nạp sổ ban đầu. Chờ đồng bộ xong rồi thử ghép lại.',
        },
        409,
      )
    }
    if (outcome !== 'ok') return this.pairInvalid()
    return json(
      {
        shopId: this.shopId(),
        deviceId,
        token,
        label,
        letter,
        admissionExpiresAt: now + PAIR_ADMISSION_TTL_MS,
      },
      201,
    )
  }

  private async createPairCode(request: Request): Promise<Response> {
    const tokenHash = await this.requestTokenHash(request)
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const secret = generatePairSecret()
    const codeHash = await hashSecret(secret)
    const expiresAt = Date.now() + PAIR_TTL_MS
    const created = this.ctx.storage.transactionSync(() => {
      if (!this.activeDeviceByTokenHash(tokenHash)) return false
      this.sql.exec(
        'INSERT INTO pairCodes (codeHash, expiresAt, usedAt, createdAt) VALUES (?, ?, NULL, ?)',
        codeHash,
        expiresAt,
        Date.now(),
      )
      return true
    })
    if (!created) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    return json({ code: routedPairCode(this.shopId(), secret), expiresAt }, 201)
  }

  private async listDevices(request: Request): Promise<Response> {
    const current = await this.authenticate(request)
    if (!current) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const devices = [...this.sql.exec<DeviceRow>(
      'SELECT id, letter, label, tokenHash, createdAt, revokedAt FROM devices ORDER BY createdAt ASC',
    )].map((device) => ({
      id: device.id,
      letter: device.letter,
      label: device.label,
      createdAt: device.createdAt,
      revokedAt: device.revokedAt,
      current: device.id === current.id,
    }))
    // `seq` là alias của rowid nên MAX là một lần seek, không quét bảng — cùng câu lệnh activateDevice dùng.
    const latestSeq =
      Number(first(this.sql.exec<{ seq: number }>('SELECT MAX(seq) AS seq FROM oplog'))?.seq) || 0
    return json({ devices, latestSeq })
  }

  private async revokeDevice(request: Request, deviceId: string): Promise<Response> {
    const tokenHash = await this.requestTokenHash(request)
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const now = Date.now()
    const outcome = this.ctx.storage.transactionSync<'ok' | 'unauthorized' | 'not-found'>(() => {
      const current = this.activeDeviceByTokenHash(tokenHash, true)
      if (!current) return 'unauthorized'
      const currentPending = first(
        this.sql.exec<{ deviceId: string }>(
          'SELECT deviceId FROM ledgerAdmission WHERE deviceId = ? LIMIT 1',
          current.id,
        ),
      )
      if (currentPending && current.id !== deviceId) return 'unauthorized'
      const target = first(
        this.sql.exec<{ id: string; revokedAt: number | null }>(
          'SELECT id, revokedAt FROM devices WHERE id = ? LIMIT 1',
          deviceId,
        ),
      )
      if (!target || target.revokedAt !== null) return 'not-found'
      const pending = first(
        this.sql.exec<{ deviceId: string }>(
          'SELECT deviceId FROM ledgerAdmission WHERE deviceId = ? LIMIT 1',
          deviceId,
        ),
      )
      if (pending) {
        this.sql.exec('DELETE FROM ledgerAdmission WHERE deviceId = ?', deviceId)
        this.sql.exec('DELETE FROM devices WHERE id = ?', deviceId)
      } else {
        this.sql.exec('UPDATE devices SET revokedAt = ? WHERE id = ?', now, deviceId)
      }
      return 'ok'
    })
    if (outcome === 'unauthorized') {
      return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    }
    if (outcome === 'not-found') return json({ error: 'device-not-found' }, 404)

    for (const socket of this.ctx.getWebSockets(`device:${deviceId}`)) {
      socket.close(4003, 'Thiết bị đã bị thu hồi')
    }
    return json({ revoked: true, deviceId })
  }

  private async openSocket(request: Request): Promise<Response> {
    const device = await this.authenticate(request)
    if (!device) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'upgrade-required' }, 426)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [`device:${device.id}`])
    server.serializeAttachment({ deviceId: device.id })
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'sec-websocket-protocol': 'my-biller' },
    })
  }

  private currentEpoch(deviceId: string): number {
    return (
      first(
        this.sql.exec<{ epoch: number }>(
          'SELECT epoch FROM deviceEpochs WHERE deviceId = ? LIMIT 1',
          deviceId,
        ),
      )?.epoch ?? 0
    )
  }

  private async claimEpoch(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const epoch = typeof body?.epoch === 'number' && Number.isInteger(body.epoch) ? body.epoch : 0
    if (epoch <= 0) return json({ error: 'invalid-request' }, 400)

    const accepted = this.ctx.storage.transactionSync<'accepted' | 'stale' | 'unauthorized'>(() => {
      const device = this.activeDeviceByTokenHash(tokenHash)
      if (!device) return 'unauthorized'
      const current = this.currentEpoch(device.id)
      if (epoch < current) return 'stale'
      this.sql.exec(
        'INSERT INTO deviceEpochs (deviceId, epoch) VALUES (?, ?) ON CONFLICT(deviceId) DO UPDATE SET epoch = excluded.epoch WHERE excluded.epoch >= deviceEpochs.epoch',
        device.id,
        epoch,
      )
      return 'accepted'
    })
    if (accepted === 'unauthorized') {
      return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    }
    return accepted === 'accepted'
      ? json({ epoch })
      : json({ error: 'stale-leader', message: 'Một tab khác đang đồng bộ máy này.' }, 409)
  }

  private ledgerPayload(table: string, entityKey: string): { after: Record<string, unknown>; refs: Record<string, string | null> } | null {
    const row = first(
      this.sql.exec<LedgerRow>(
        'SELECT payload FROM ledger WHERE tableName = ? AND entityKey = ? LIMIT 1',
        table,
        entityKey,
      ),
    )
    if (!row) return null
    return JSON.parse(row.payload) as { after: Record<string, unknown>; refs: Record<string, string | null> }
  }

  private canonicalizeReferences(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    const expected = [...REFERENCE_FIELDS[event.table]].sort()
    const actual = Object.keys(event.refs).sort()
    if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) {
      return { problem: `Liên kết của bảng ${event.table} không đúng hợp đồng.` }
    }
    for (const field of expected) {
      if (REQUIRED_REFERENCES.has(`${event.table}.${field}`) && event.refs[field] === null) {
        return { problem: `Liên kết ${field} của bảng ${event.table} là bắt buộc.` }
      }
    }
    const withoutLocalReferences = (payload: Record<string, unknown> | null) => {
      if (!payload) return null
      const canonical = { ...payload }
      for (const field of LOCAL_FOREIGN_KEYS) delete canonical[field]
      return canonical
    }
    return {
      event: {
        ...event,
        before: withoutLocalReferences(event.before),
        after: withoutLocalReferences(event.after),
      },
    }
  }

  private parentProblem(event: SyncEvent): string | null {
    if (event.operation === 'delete') return null
    const parentTable: Record<string, string> = {
      groupId: 'itemGroups',
      customerId: 'customers',
      itemId: 'items',
      orderId: 'orders',
      allocatedOrderId: 'orders',
      categoryId: 'expenseCategories',
    }
    for (const [field, parentGid] of Object.entries(event.refs)) {
      if (parentGid === null) continue
      const table = parentTable[field]
      if (table && !this.ledgerPayload(table, parentGid)) return `Thiếu bản ghi cha ${table}.`
    }
    return null
  }

  private deleteProblem(event: SyncEvent): string | null {
    if (event.operation !== 'delete') return null
    if (event.table === 'orders' || event.table === 'payments') {
      return 'Đơn và phiếu thu là lịch sử tiền, không được xoá.'
    }
    for (const row of this.sql.exec<LedgerRow>('SELECT payload FROM ledger')) {
      const child = JSON.parse(row.payload) as {
        refs: Record<string, string | null>
      }
      if (Object.values(child.refs).includes(event.entityKey)) {
        return 'Bản ghi đang được dữ liệu khác sử dụng; hãy gỡ liên kết trước khi xoá.'
      }
    }
    return null
  }

  private catalogPayload(entityKey: string): Record<string, unknown> | null {
    const row = first(
      this.sql.exec<LedgerRow>(
        "SELECT payload FROM catalogLedger WHERE tableName = 'optionGroups' AND entityKey = ? LIMIT 1",
        entityKey,
      ),
    )
    return row ? (JSON.parse(row.payload) as { after: Record<string, unknown> }).after : null
  }

  /**
   * Chỉ gid mới thêm bị kiểm: gid đã nằm trong bản lưu mà nhóm sau đó bị xoá là trạng thái hợp lệ (đọc thì ẩn),
   * sửa giá món không được vì nó mà bị từ chối rồi cuộn mất cả đuôi hàng đợi.
   */
  private optionGroupGidsProblem(event: SyncEvent): string | null {
    if ((event.table !== 'items' && event.table !== 'itemGroups') || !event.after) return null
    const gids = event.after.optionGroupGids
    if (!Array.isArray(gids)) return null
    const stored = this.ledgerPayload(event.table, event.entityKey)?.after.optionGroupGids
    const known = new Set(Array.isArray(stored) ? stored : [])
    const missing = gids.some((gid) => !known.has(gid) && !this.catalogPayload(String(gid)))
    return missing ? 'Món hoặc nhóm món trỏ tới một nhóm lựa chọn chưa có trong sổ chung.' : null
  }

  /** Cùng định nghĩa "đang dùng" với `deleteItem` ở client: chỉ nhóm topping đang bật. */
  private toppingInUseProblem(event: SyncEvent): string | null {
    if (event.table !== 'items' || event.operation !== 'delete') return null
    for (const row of this.sql.exec<LedgerRow>("SELECT payload FROM catalogLedger WHERE tableName = 'optionGroups'")) {
      const group = (JSON.parse(row.payload) as { after: Record<string, unknown> }).after
      const toppings = Array.isArray(group.toppings) ? (group.toppings as unknown[]) : []
      if (
        group.isActive === 1 &&
        group.kind === 'topping' &&
        toppings.some((topping) => isRecord(topping) && topping.itemGid === event.entityKey)
      ) {
        return `Món đang thuộc nhóm topping “${String(group.name)}”; gỡ khỏi nhóm trước khi xoá.`
      }
    }
    return null
  }

  /**
   * Nhóm đang tắt không bán được nên không kiểm: gộp trùng tên có thể gỡ hết topping của một nhóm và tắt nó, mà nhóm
   * đó vẫn phải lên được sổ chung. Topping đã có trong bản lưu cũng bỏ qua, cùng lẽ với `optionGroupGidsProblem`.
   */
  private catalogToppingProblem(event: CatalogEvent): string | null {
    const after = event.after
    if (event.operation === 'delete' || !after || after.isActive !== 1 || after.kind !== 'topping') return null
    const stored = this.catalogPayload(event.entityKey)
    const storedToppings = Array.isArray(stored?.toppings) ? (stored.toppings as unknown[]) : []
    const known = new Set(storedToppings.map((topping) => (isRecord(topping) ? topping.itemGid : null)))
    for (const topping of after.toppings as { itemGid: string }[]) {
      if (known.has(topping.itemGid)) continue
      const item = this.ledgerPayload('items', topping.itemGid)?.after
      if (!item || item.kind !== 'topping') {
        return `Nhóm “${String(after.name)}” trỏ tới một món không phải món topping trong sổ chung.`
      }
    }
    return null
  }

  private paidForOrder(orderGid: string, exceptPaymentGid: string | null = null): number {
    let paid = 0
    for (const row of this.sql.exec<LedgerRow>(
      'SELECT payload FROM ledger WHERE tableName = ?',
      'payments',
    )) {
      const payment = JSON.parse(row.payload) as {
        after: Record<string, unknown>
        refs: Record<string, string | null>
      }
      if (
        payment.refs.allocatedOrderId !== orderGid ||
        payment.after.gid === exceptPaymentGid ||
        payment.after.unallocatedStatus === 'refunded' ||
        payment.after.unallocatedStatus === 'discarded'
      ) {
        continue
      }
      const amount = Number(payment.after.amount)
      if (Number.isInteger(amount) && amount > 0) paid += amount
    }
    return paid
  }

  private orderStatus(total: number, paid: number): 'paid' | 'partial' | 'unpaid' {
    if (paid >= total) return 'paid'
    if (paid > 0) return 'partial'
    return 'unpaid'
  }

  private paymentProblem(event: SyncEvent): string | null {
    if (event.table !== 'payments') return null
    if (event.operation === 'delete' || !event.after) return 'Phiếu thu không được xoá.'
    if (
      event.after.gid !== event.entityGid ||
      !Number.isInteger(event.after.amount) ||
      Number(event.after.amount) <= 0 ||
      !['cash', 'transfer'].includes(String(event.after.method)) ||
      typeof event.after.note !== 'string' ||
      !Number.isInteger(event.after.paidAt) ||
      !event.refs.orderId
    ) {
      return 'Phiếu thu không hợp lệ.'
    }
    if (
      event.after.unallocatedStatus !== undefined &&
      !['pending', 'refunded', 'discarded'].includes(String(event.after.unallocatedStatus))
    ) {
      return 'Trạng thái xử lý phiếu thu không hợp lệ.'
    }
    if (
      event.after.resolutionNote !== undefined &&
      typeof event.after.resolutionNote !== 'string'
    ) {
      return 'Ghi chú xử lý phiếu thu không hợp lệ.'
    }

    const allocatedOrderGid = event.refs.allocatedOrderId
    if (!allocatedOrderGid) return null
    if (['refunded', 'discarded'].includes(String(event.after.unallocatedStatus))) {
      return 'Phiếu thu đã hoàn hoặc loại không thể gắn vào đơn.'
    }
    const order = this.ledgerPayload('orders', allocatedOrderGid)
    const total = Number(order?.after.total)
    if (!order || !Number.isInteger(total) || order.after.status === 'void') {
      return 'Đơn nhận khoản thu không còn phù hợp.'
    }
    const allocated = this.paidForOrder(allocatedOrderGid, event.entityGid)
    if (allocated + Number(event.after.amount) > total) {
      return 'Số nợ đã thay đổi; khoản thu được giữ lại nhưng chưa gắn vào đơn.'
    }
    return null
  }

  private canonicalizePayment(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    if (event.table !== 'payments' || event.operation === 'create') return { event }
    if (event.operation === 'delete' || !event.after) return { problem: 'Phiếu thu không được xoá.' }
    const stored = this.ledgerPayload('payments', event.entityKey)
    if (!stored) return { problem: 'Không tìm thấy phiếu thu cần cập nhật.' }
    if (['refunded', 'discarded'].includes(String(stored.after.unallocatedStatus))) {
      return { problem: 'Phiếu thu đã được xử lý và không thể thay đổi.' }
    }

    for (const field of ['gid', 'amount', 'method', 'note'] as const) {
      if (event.after[field] !== stored.after[field]) {
        return { problem: 'Số tiền và nội dung gốc của phiếu thu không được sửa.' }
      }
    }
    if (
      event.refs.orderId !== stored.refs.orderId ||
      event.refs.customerId !== stored.refs.customerId
    ) {
      return { problem: 'Đơn và khách gốc của phiếu thu không được sửa.' }
    }

    if (stored.refs.allocatedOrderId) {
      const requestsLegacyVoidDetachment =
        event.refs.allocatedOrderId === null &&
        !['refunded', 'discarded'].includes(String(event.after.unallocatedStatus))
      if (!requestsLegacyVoidDetachment) {
        return { problem: 'Phiếu thu đã được phân bổ và không thể thay đổi.' }
      }

      // Client cũ gửi payment-detach trước order-void. Không tin cú detach riêng lẻ: ghi một event
      // no-op để client được đi tiếp tới order-void; chính order-void phía server mới gọi
      // detachPaymentsForVoid và tạo trạng thái pending canonical.
      return {
        event: {
          ...event,
          before: stored.after,
          after: stored.after,
          refs: stored.refs,
        },
      }
    }

    const storedStatus = String(stored.after.unallocatedStatus ?? 'pending')
    const proposedStatus = String(event.after.unallocatedStatus ?? 'pending')
    if (
      storedStatus === 'pending' &&
      proposedStatus === 'pending' &&
      event.refs.allocatedOrderId === null
    ) {
      // Order-void phía server có thể đã detach trước khi event detach của client tới. Giữ nguyên
      // reason canonical thay vì để client cũ (chưa có hai field này) vô tình xoá nó.
      return {
        event: {
          ...event,
          before: stored.after,
          after: stored.after,
          refs: stored.refs,
        },
      }
    }

    const after: Record<string, unknown> = {
      ...stored.after,
    }
    for (const field of ['unallocatedStatus', 'resolutionNote'] as const) {
      if (event.after[field] === undefined) delete after[field]
      else after[field] = event.after[field]
    }
    return {
      event: {
        ...event,
        after,
        refs: { ...stored.refs, allocatedOrderId: event.refs.allocatedOrderId ?? null },
      },
    }
  }

  private canonicalizeOrder(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    if (event.table !== 'orders' || !event.after) return { event }
    const stored = this.ledgerPayload('orders', event.entityKey)
    if (event.operation === 'put') {
      if (!stored) return { problem: 'Không tìm thấy đơn cần cập nhật.' }
      for (const field of [
        'gid',
        'code',
        'originalCode',
        'customerName',
        'subtotal',
        'discount',
        'surcharge',
        'total',
        'createdAt',
      ] as const) {
        if (event.after[field] !== stored.after[field]) {
          return { problem: 'Thông tin tiền và ảnh chụp gốc của đơn không được sửa.' }
        }
      }
      if (event.refs.customerId !== stored.refs.customerId || typeof event.after.note !== 'string') {
        return { problem: 'Khách hoặc ghi chú của đơn không hợp lệ.' }
      }
      const total = Number(stored.after.total)
      const isVoid = stored.after.status === 'void' || event.after.status === 'void'
      const paidAmount = isVoid ? 0 : this.paidForOrder(event.entityKey)
      return {
        event: {
          ...event,
          after: {
            ...stored.after,
            note: event.after.note,
            updatedAt: event.after.updatedAt,
            paidAmount,
            status: isVoid ? 'void' : this.orderStatus(total, paidAmount),
          },
          refs: stored.refs,
        },
      }
    }

    const total = Number(event.after.total)
    if (
      event.operation !== 'create' ||
      event.after.gid !== event.entityGid ||
      !Number.isInteger(total) ||
      total < 0 ||
      typeof event.after.note !== 'string'
    ) {
      return { problem: 'Đơn không hợp lệ.' }
    }
    const isVoid = event.after.status === 'void'
    return {
      event: {
        ...event,
        after: {
          ...event.after,
          paidAmount: 0,
          status: isVoid ? 'void' : this.orderStatus(total, 0),
        },
      },
    }
  }

  private identityProblem(event: SyncEvent): string | null {
    if (event.table === 'settings') {
      if (event.entityGid !== null || !SETTINGS_KEYS.has(event.entityKey)) {
        return 'Khoá bản ghi cài đặt không hợp lệ.'
      }
      if (event.before && event.before.key !== event.entityKey) {
        return 'Khoá bản ghi cài đặt không khớp dữ liệu trước thay đổi.'
      }
      if (event.after && event.after.key !== event.entityKey) {
        return 'Khoá bản ghi cài đặt không khớp dữ liệu sau thay đổi.'
      }
      const payload = event.operation === 'delete' ? event.before : event.after
      return payload ? null : 'Sự kiện cài đặt thiếu dữ liệu mang khoá bản ghi.'
    }

    if (event.entityGid !== event.entityKey) {
      return 'Khoá bản ghi và gid của sự kiện không khớp.'
    }
    if (event.before && event.before.gid !== event.entityKey) {
      return 'gid của dữ liệu trước thay đổi không khớp khoá bản ghi.'
    }
    if (event.after && event.after.gid !== event.entityKey) {
      return 'gid của dữ liệu sau thay đổi không khớp khoá bản ghi.'
    }
    const payload = event.operation === 'delete' ? event.before : event.after
    return payload ? null : 'Sự kiện thiếu dữ liệu mang gid của bản ghi.'
  }

  private validateEventPayloads(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    const validate = (payload: Record<string, unknown> | null) => {
      if (payload === null) return { success: true as const, data: null }
      return safeParseLedgerPayload(event.table, payload)
    }
    const before = validate(event.before)
    const after = validate(event.after)
    if (!before.success || !after.success) {
      return { problem: `Dữ liệu bảng ${event.table} không đúng hợp đồng.` }
    }
    return {
      event: {
        ...event,
        before: before.data,
        after: after.data,
      },
    }
  }

  /**
   * Máy chạy bản cũ không biết thực đơn tuỳ chọn/topping của nhóm món, nên đổi tên nhóm xong nó đẩy lên bản
   * ghi KHÔNG có hai trường đó — và schema Worker điền mảng rỗng cho chúng. Không giữ lại thì last-write-wins
   * xoá sạch thực đơn trên mọi máy. Chỉ giữ khi payload gốc thiếu hẳn trường: máy mới cố ý xoá hết thực đơn
   * vẫn gửi `[]` rõ ràng và được tôn trọng.
   */
  private preserveItemGroupMenu(raw: SyncEvent, event: SyncEvent): SyncEvent {
    if (event.table !== 'itemGroups' || !event.after || !raw.after) return event
    const stored = this.ledgerPayload('itemGroups', event.entityKey)?.after
    if (!stored) return event
    const after = { ...event.after }
    for (const field of ['optionGroups', 'toppingMenu', 'optionGroupGids']) {
      if (!(field in raw.after) && field in stored) after[field] = stored[field]
    }
    return { ...event, after }
  }

  /**
   * Máy bản cũ không biết món topping: sửa giá món topping là đẩy lên bản ghi thiếu `kind` và `optionGroupGids`.
   * Ghi đè theo last-write-wins thì món topping thành món thường và mất nhóm lựa chọn trên mọi máy.
   */
  private preserveItemCatalog(raw: SyncEvent, event: SyncEvent): SyncEvent {
    if (event.table !== 'items' || !event.after || !raw.after) return event
    const stored = this.ledgerPayload('items', event.entityKey)?.after
    if (!stored) return event
    const after = { ...event.after }
    for (const field of ['kind', 'optionGroupGids']) {
      if (!(field in raw.after) && field in stored) after[field] = stored[field]
    }
    return { ...event, after }
  }

  /**
   * Cùng bẫy với thực đơn nhóm món, nhưng nằm sâu một tầng trong `value` của bản ghi `shop`: máy bản cũ bỏ `logo` và
   * `labelWatermark` khi đọc, rồi lưu thông tin quán là đẩy lên cả bản ghi thiếu hai khoá — last-write-wins xoá logo
   * trên mọi máy. Máy mới luôn ghi đủ hai khoá (gỡ logo là `null` tường minh), nên thiếu hẳn khoá chỉ có thể là máy cũ.
   * Cùng lẽ đó một tầng sâu hơn: bản 2.10.0 bỏ `labelWatermark.align`, lưu là kéo logo bên phải về giữa.
   */
  private preserveShopBranding(raw: SyncEvent, event: SyncEvent): SyncEvent {
    if (event.table !== 'settings' || event.entityKey !== 'shop' || !event.after || !raw.after) return event
    const rawValue = raw.after.value
    const storedValue = this.ledgerPayload('settings', 'shop')?.after?.value
    if (!isRecord(rawValue) || !isRecord(storedValue) || !isRecord(event.after.value)) return event
    const value = { ...event.after.value }
    for (const field of ['logo', 'labelWatermark']) {
      if (!(field in rawValue) && field in storedValue) value[field] = storedValue[field]
    }
    const rawWatermark = rawValue.labelWatermark
    const storedWatermark = storedValue.labelWatermark
    if (
      isRecord(rawWatermark) &&
      !('align' in rawWatermark) &&
      isRecord(storedWatermark) &&
      'align' in storedWatermark &&
      isRecord(value.labelWatermark)
    ) {
      value.labelWatermark = { ...value.labelWatermark, align: storedWatermark.align }
    }
    return { ...event, after: { ...event.after, value } }
  }

  private canonicalizeEvent(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    const checked = this.validateEventPayloads(event)
    if ('problem' in checked) return checked
    const validated = {
      event: this.preserveShopBranding(
        event,
        this.preserveItemCatalog(event, this.preserveItemGroupMenu(event, checked.event)),
      ),
    }
    const identityProblem = this.identityProblem(validated.event)
    if (identityProblem) return { problem: identityProblem }
    if (validated.event.operation === 'delete') return validated
    if (!validated.event.after) return { problem: 'Sự kiện ghi thiếu dữ liệu sau thay đổi.' }
    const payment = this.canonicalizePayment(validated.event)
    if ('problem' in payment) return payment
    return this.canonicalizeOrder(payment.event)
  }

  private appendEvent(event: SyncEvent, deviceId: string, serverAt: number): number {
    this.sql.exec(
      'INSERT INTO oplog (eventId, entityKey, tableName, operation, payload, deviceId, serverAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      event.eventId,
      event.entityKey,
      event.table,
      event.operation,
      '{}',
      deviceId,
      serverAt,
    )
    const seq = Number(first(this.sql.exec<{ seq: number }>('SELECT last_insert_rowid() AS seq'))?.seq)
    const serverEvent = { ...event, seq, deviceId, serverAt }
    this.sql.exec('UPDATE oplog SET payload = ? WHERE seq = ?', JSON.stringify(serverEvent), seq)

    if (event.operation === 'delete') {
      this.sql.exec(
        'DELETE FROM ledger WHERE tableName = ? AND entityKey = ?',
        event.table,
        event.entityKey,
      )
    } else {
      this.sql.exec(
        'INSERT INTO ledger (tableName, entityKey, payload, updatedSeq) VALUES (?, ?, ?, ?) ON CONFLICT(tableName, entityKey) DO UPDATE SET payload = excluded.payload, updatedSeq = excluded.updatedSeq',
        event.table,
        event.entityKey,
        JSON.stringify({ after: event.after, refs: event.refs }),
        seq,
      )
    }
    return seq
  }

  private detachPaymentsForVoid(
    orderGid: string,
    source: SyncEvent,
    deviceId: string,
    serverAt: number,
  ): void {
    for (const row of this.sql.exec<{ entityKey: string; payload: string }>(
      'SELECT entityKey, payload FROM ledger WHERE tableName = ?',
      'payments',
    )) {
      const payment = JSON.parse(row.payload) as {
        after: Record<string, unknown>
        refs: Record<string, string | null>
      }
      if (payment.refs.allocatedOrderId !== orderGid) continue
      const after = {
        ...payment.after,
        unallocatedStatus: 'pending',
        resolutionNote: 'Đơn đã huỷ; khoản thu chờ xử lý.',
      }
      const detached: SyncEvent = {
        eventId: crypto.randomUUID(),
        txId: source.txId,
        txOrder: source.txOrder,
        table: 'payments',
        entityKey: row.entityKey,
        entityGid: row.entityKey,
        operation: 'put',
        before: payment.after,
        after,
        refs: { ...payment.refs, allocatedOrderId: null },
      }
      this.appendEvent(detached, deviceId, serverAt)
    }
  }

  private refreshOrderFromPayments(
    orderGid: string,
    source: SyncEvent,
    deviceId: string,
    serverAt: number,
  ): number | null {
    const order = this.ledgerPayload('orders', orderGid)
    if (!order) return null
    const total = Number(order.after.total)
    const isVoid = order.after.status === 'void'
    const paidAmount = isVoid ? 0 : this.paidForOrder(orderGid)
    const status = isVoid ? 'void' : this.orderStatus(total, paidAmount)
    if (order.after.paidAmount === paidAmount && order.after.status === status) return null

    const event: SyncEvent = {
      eventId: crypto.randomUUID(),
      txId: source.txId,
      txOrder: source.txOrder + 1,
      table: 'orders',
      entityKey: orderGid,
      entityGid: orderGid,
      operation: 'put',
      before: order.after,
      after: { ...order.after, paidAmount, status },
      refs: order.refs,
    }
    return this.appendEvent(event, deviceId, serverAt)
  }

  private stampServerTime(event: SyncEvent, serverAt: number): SyncEvent {
    if (event.operation !== 'create' || !event.after) return event
    const after = { ...event.after }
    if (event.table === 'orders') after.soldAt = serverAt
    if (event.table === 'payments') after.paidAt = serverAt
    if (event.table === 'expenses') after.spentAt = serverAt
    return { ...event, after }
  }

  /**
   * Chỉ áp cho máy có khai báo khả năng `item-name-taken`: máy cũ không biết mã này sẽ nuốt lỗi
   * hoặc cuộn ngược đuôi hàng đợi, nên luật chỉ bật khi `acceptEvent` biết chắc máy hiểu được.
   * Món topping chỉ bán kèm (`isActive: 0`) cũng giữ tên của nó, nhưng chỉ với máy `catalog-v2`: máy cũ không
   * thấy món đó trên lưới nên trả `item-name-taken` cho nó là chặn một tên nó không có cách nào nhìn ra.
   */
  private itemNameTaken(
    event: SyncEvent,
    countHiddenToppings: boolean,
  ): { existingGid: string; existingName: string } | null {
    if (event.table !== 'items' || event.operation === 'delete' || !event.after) return null
    if (event.after.isActive !== 1) return null
    const key = itemNameKey(String(event.after.name))
    const stored = this.ledgerPayload('items', event.entityKey)?.after
    const claims = !stored || stored.isActive !== 1 || itemNameKey(String(stored.name)) !== key
    if (!claims) return null
    // `ORDER BY updatedSeq` để kết quả tất định: sổ có sẵn ≥2 món trùng tên từ trước thì luôn nối
    // vào món có lần ghi gần nhất cũ nhất, không tuỳ ý SQLite trả hàng theo thứ tự nào.
    for (const row of this.sql.exec<{ entityKey: string; payload: string }>(
      "SELECT entityKey, payload FROM ledger WHERE tableName = 'items' AND entityKey != ? ORDER BY updatedSeq ASC",
      event.entityKey,
    )) {
      const other = (JSON.parse(row.payload) as { after: { name: string; isActive: number; kind?: string } }).after
      const claimed = other.isActive === 1 || (countHiddenToppings && other.kind === 'topping')
      if (claimed && itemNameKey(other.name) === key) {
        return { existingGid: row.entityKey, existingName: other.name }
      }
    }
    return null
  }

  private async acceptEvent(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const parsed = SyncEventSchema.safeParse(body?.event)
    const epoch = typeof body?.epoch === 'number' && Number.isInteger(body.epoch) ? body.epoch : 0
    const caps = Array.isArray(body?.caps) ? (body.caps as unknown[]) : []
    if (!parsed.success || epoch <= 0) return json({ error: 'invalid-request' }, 400)

    const serverAt = Date.now()
    const proposed = this.stampServerTime(parsed.data, serverAt)
    const result = this.ctx.storage.transactionSync<
      | { ok: true; seq: number; notifySeq: number; duplicate: boolean }
      | {
          ok: false
          error: 'unauthorized' | 'stale-leader' | 'business-rejected' | 'seed-in-progress'
          message: string
        }
      | { ok: false; error: 'item-name-taken'; message: string; existingGid: string; existingName: string }
    >(() => {
      this.expireLedgerAdmission(serverAt)
      const device = this.activeDeviceByTokenHash(tokenHash)
      if (!device) {
        return { ok: false, error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }
      }
      if (epoch !== this.currentEpoch(device.id)) {
        return { ok: false, error: 'stale-leader', message: 'Một tab khác đang đồng bộ máy này.' }
      }
      const existing = first(
        this.sql.exec<{ seq: number }>('SELECT seq FROM oplog WHERE eventId = ? LIMIT 1', proposed.eventId),
      )
      if (existing) return { ok: true, seq: existing.seq, notifySeq: existing.seq, duplicate: true }

      const admission = first(
        this.sql.exec<LedgerAdmissionRow>(
          'SELECT deviceId, codeHash, expectedRows, expiresAt FROM ledgerAdmission LIMIT 1',
        ),
      )
      if (admission && admission.expectedRows > 0) {
        return {
          ok: false,
          error: 'seed-in-progress',
          message: 'Máy đầu tiên đang nạp sổ; thay đổi này sẽ tự thử lại sau.',
        }
      }

      const referenced = this.canonicalizeReferences(proposed)
      if ('problem' in referenced) {
        return { ok: false, error: 'business-rejected', message: referenced.problem }
      }
      const identityProblem = this.identityProblem(referenced.event)
      if (identityProblem) {
        return { ok: false, error: 'business-rejected', message: identityProblem }
      }

      if (proposed.operation === 'create') {
        const entity = first(
          this.sql.exec<{ updatedSeq: number }>(
            'SELECT updatedSeq FROM ledger WHERE tableName = ? AND entityKey = ? LIMIT 1',
            proposed.table,
            proposed.entityKey,
          ),
        )
        if (entity) {
          return { ok: true, seq: entity.updatedSeq, notifySeq: entity.updatedSeq, duplicate: false }
        }
      }

      const parentProblem = this.parentProblem(referenced.event)
      if (parentProblem) {
        return { ok: false, error: 'business-rejected', message: parentProblem }
      }
      const deleteProblem =
        this.deleteProblem(referenced.event) ??
        (caps.includes(CATALOG_V2) ? this.toppingInUseProblem(referenced.event) : null)
      if (deleteProblem) {
        return { ok: false, error: 'business-rejected', message: deleteProblem }
      }
      const canonical = this.canonicalizeEvent(referenced.event)
      if ('problem' in canonical) {
        return { ok: false, error: 'business-rejected', message: canonical.problem }
      }
      const optionGroupGidsProblem = caps.includes(CATALOG_V2) ? this.optionGroupGidsProblem(canonical.event) : null
      if (optionGroupGidsProblem) {
        return { ok: false, error: 'business-rejected', message: optionGroupGidsProblem }
      }
      if (caps.includes('item-name-taken')) {
        const taken = this.itemNameTaken(canonical.event, caps.includes('catalog-v2'))
        if (taken) {
          return {
            ok: false,
            error: 'item-name-taken',
            message: `Đã có món “${taken.existingName}” đang bán trong sổ chung.`,
            ...taken,
          }
        }
      }
      const paymentProblem = this.paymentProblem(canonical.event)
      if (paymentProblem) {
        return { ok: false, error: 'business-rejected', message: paymentProblem }
      }

      const previousPayment =
        canonical.event.table === 'payments'
          ? this.ledgerPayload('payments', canonical.event.entityKey)
          : null
      if (
        canonical.event.table === 'orders' &&
        canonical.event.operation === 'put' &&
        canonical.event.after?.status === 'void'
      ) {
        this.detachPaymentsForVoid(
          canonical.event.entityKey,
          canonical.event,
          device.id,
          serverAt,
        )
      }
      const seq = this.appendEvent(canonical.event, device.id, serverAt)
      let notifySeq = seq
      if (canonical.event.table === 'payments') {
        const affected = new Set(
          [previousPayment?.refs.allocatedOrderId, canonical.event.refs.allocatedOrderId].filter(
            (gid): gid is string => typeof gid === 'string',
          ),
        )
        for (const orderGid of affected) {
          notifySeq =
            this.refreshOrderFromPayments(orderGid, canonical.event, device.id, serverAt) ?? notifySeq
        }
      }
      return { ok: true, seq, notifySeq, duplicate: false }
    })

    if (!result.ok) {
      const body: Record<string, unknown> = { error: result.error, message: result.message }
      if (result.error === 'item-name-taken') {
        body.existingGid = result.existingGid
        body.existingName = result.existingName
      }
      return json(body, result.error === 'unauthorized' ? 401 : 409)
    }
    if (!result.duplicate) {
      for (const socket of this.ctx.getWebSockets()) {
        socket.send(JSON.stringify({ type: 'oplog', seq: result.notifySeq }))
      }
    }
    return json({ seq: result.seq, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
  }

  private validateCatalogEvent(event: CatalogEvent): { event: CatalogEvent } | { problem: string } {
    if (event.entityGid !== event.entityKey) return { problem: 'Khoá bản ghi và gid của sự kiện không khớp.' }
    const validate = (payload: Record<string, unknown> | null) => {
      if (payload === null) return { success: true as const, data: null }
      if (payload.gid !== event.entityKey) return { success: false as const }
      return safeParseCatalogPayload(event.table, payload)
    }
    const before = validate(event.before)
    const after = validate(event.after)
    if (!before.success || !after.success) {
      return { problem: `Dữ liệu bảng ${event.table} không đúng hợp đồng.` }
    }
    const payload = event.operation === 'delete' ? before.data : after.data
    if (!payload) return { problem: 'Sự kiện thiếu dữ liệu mang gid của bản ghi.' }
    return { event: { ...event, before: before.data, after: after.data } }
  }

  private appendCatalogEvent(event: CatalogEvent, deviceId: string, serverAt: number): number {
    this.sql.exec(
      'INSERT INTO catalogOplog (eventId, entityKey, tableName, operation, payload, deviceId, serverAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      event.eventId,
      event.entityKey,
      event.table,
      event.operation,
      '{}',
      deviceId,
      serverAt,
    )
    const seq = Number(first(this.sql.exec<{ seq: number }>('SELECT last_insert_rowid() AS seq'))?.seq)
    this.sql.exec('UPDATE catalogOplog SET payload = ? WHERE seq = ?', JSON.stringify({ ...event, seq, deviceId, serverAt }), seq)
    if (event.operation === 'delete') {
      this.sql.exec('DELETE FROM catalogLedger WHERE tableName = ? AND entityKey = ?', event.table, event.entityKey)
    } else {
      this.sql.exec(
        'INSERT INTO catalogLedger (tableName, entityKey, payload, updatedSeq) VALUES (?, ?, ?, ?) ON CONFLICT(tableName, entityKey) DO UPDATE SET payload = excluded.payload, updatedSeq = excluded.updatedSeq',
        event.table,
        event.entityKey,
        JSON.stringify({ after: event.after }),
        seq,
      )
    }
    return seq
  }

  private async acceptCatalogEvent(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const parsed = CatalogEventSchema.safeParse(body?.event)
    const epoch = typeof body?.epoch === 'number' && Number.isInteger(body.epoch) ? body.epoch : 0
    if (!parsed.success || epoch <= 0) return json({ error: 'invalid-request' }, 400)

    const serverAt = Date.now()
    const result = this.ctx.storage.transactionSync<
      | { ok: true; seq: number; duplicate: boolean }
      | {
          ok: false
          error: 'unauthorized' | 'stale-leader' | 'business-rejected' | 'seed-in-progress'
          message: string
        }
    >(() => {
      this.expireLedgerAdmission(serverAt)
      const device = this.activeDeviceByTokenHash(tokenHash)
      if (!device) return { ok: false, error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }
      if (epoch !== this.currentEpoch(device.id)) {
        return { ok: false, error: 'stale-leader', message: 'Một tab khác đang đồng bộ máy này.' }
      }
      const existing = first(
        this.sql.exec<{ seq: number }>('SELECT seq FROM catalogOplog WHERE eventId = ? LIMIT 1', parsed.data.eventId),
      )
      if (existing) return { ok: true, seq: existing.seq, duplicate: true }
      const admission = first(this.sql.exec<{ expectedRows: number }>('SELECT expectedRows FROM ledgerAdmission LIMIT 1'))
      if (admission && admission.expectedRows > 0) {
        return {
          ok: false,
          error: 'seed-in-progress',
          message: 'Máy đầu tiên đang nạp sổ; thay đổi này sẽ tự thử lại sau.',
        }
      }

      const validated = this.validateCatalogEvent(parsed.data)
      if ('problem' in validated) return { ok: false, error: 'business-rejected', message: validated.problem }
      if (validated.event.operation === 'create') {
        const entity = first(
          this.sql.exec<{ updatedSeq: number }>(
            'SELECT updatedSeq FROM catalogLedger WHERE tableName = ? AND entityKey = ? LIMIT 1',
            validated.event.table,
            validated.event.entityKey,
          ),
        )
        if (entity) return { ok: true, seq: entity.updatedSeq, duplicate: false }
      }
      const toppingProblem = this.catalogToppingProblem(validated.event)
      if (toppingProblem) return { ok: false, error: 'business-rejected', message: toppingProblem }
      return { ok: true, seq: this.appendCatalogEvent(validated.event, device.id, serverAt), duplicate: false }
    })

    if (!result.ok) {
      return json({ error: result.error, message: result.message }, result.error === 'unauthorized' ? 401 : 409)
    }
    if (!result.duplicate) {
      for (const socket of this.ctx.getWebSockets()) {
        socket.send(JSON.stringify({ type: 'catalog', seq: result.seq }))
      }
    }
    return json({ seq: result.seq, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
  }

  private async getCatalogOplog(request: Request): Promise<Response> {
    const device = await this.authenticate(request)
    if (!device) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const since = nonNegativeInteger(new URL(request.url).searchParams.get('since') ?? '0')
    if (since === null) return json({ error: 'invalid-request' }, 400)
    const rows = [...this.sql.exec<{ payload: string }>(
      'SELECT payload FROM catalogOplog WHERE seq > ? ORDER BY seq ASC LIMIT 500',
      since,
    )]
    return json({ events: rows.map((row) => JSON.parse(row.payload)), hasMore: rows.length === 500 })
  }

  private async activateDevice(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) {
      return json({ error: 'unauthorized', message: 'Lượt ghép máy không còn hiệu lực.' }, 401)
    }
    if (!Array.isArray(body?.events)) return json({ error: 'invalid-request' }, 400)
    const parsed: SyncEvent[] = []
    const catalog: CatalogEvent[] = []
    for (const raw of body.events) {
      const event = SyncEventSchema.safeParse(raw)
      const catalogEvent = event.success ? null : CatalogEventSchema.safeParse(raw)
      if (event.success) parsed.push(event.data)
      else if (catalogEvent?.success) catalog.push(catalogEvent.data)
      else return json({ error: 'invalid-request' }, 400)
    }

    const now = Date.now()
    try {
      const result = this.ctx.storage.transactionSync<
        | { ok: true; lastSeq: number }
        | { ok: false; error: 'unauthorized' | 'merge-required' | 'seed-incomplete'; message: string }
      >(() => {
        this.expireLedgerAdmission(now)
        const device = this.activeDeviceByTokenHash(tokenHash, true)
        if (!device) {
          return { ok: false, error: 'unauthorized', message: 'Lượt ghép máy đã hết hạn.' }
        }
        const admission = first(
          this.sql.exec<LedgerAdmissionRow>(
            'SELECT deviceId, codeHash, expectedRows, expiresAt FROM ledgerAdmission WHERE deviceId = ? LIMIT 1',
            device.id,
          ),
        )
        if (!admission) {
          const lastSeq =
            Number(first(this.sql.exec<{ seq: number }>('SELECT MAX(seq) AS seq FROM oplog'))?.seq) || 0
          return { ok: true, lastSeq }
        }
        const seedRows = parsed.length + catalog.length
        if (seedRows !== admission.expectedRows) {
          return {
            ok: false,
            error: 'seed-incomplete',
            message: `Ảnh sổ có ${seedRows}/${admission.expectedRows} dòng; chưa kích hoạt máy.`,
          }
        }
        const ledgerRows = this.countLedgerRows()
        if (admission.expectedRows > 0 && ledgerRows > 0) {
          return {
            ok: false,
            error: 'merge-required',
            message: 'Sổ chung đã có dữ liệu; phải đối soát trước khi nạp sổ máy này.',
          }
        }

        const eventIds = new Set<string>()
        const entities = new Set<string>()
        let lastSeq =
          Number(first(this.sql.exec<{ seq: number }>('SELECT MAX(seq) AS seq FROM oplog'))?.seq) || 0
        for (const source of parsed) {
          const entity = `${source.table}:${source.entityKey}`
          if (
            source.operation !== 'create' ||
            source.before !== null ||
            eventIds.has(source.eventId) ||
            entities.has(entity)
          ) {
            throw new SeedRejected('Ảnh sổ ban đầu có sự kiện trùng hoặc không phải bản ghi tạo mới.')
          }
          eventIds.add(source.eventId)
          entities.add(entity)

          const referenced = this.canonicalizeReferences(source)
          if ('problem' in referenced) throw new SeedRejected(referenced.problem)
          const parentProblem = this.parentProblem(referenced.event)
          if (parentProblem) throw new SeedRejected(parentProblem)
          const canonical = this.canonicalizeEvent(referenced.event)
          if ('problem' in canonical) throw new SeedRejected(canonical.problem)
          const paymentProblem = this.paymentProblem(canonical.event)
          if (paymentProblem) throw new SeedRejected(paymentProblem)

          lastSeq = this.appendEvent(canonical.event, device.id, now)
          if (canonical.event.table === 'payments') {
            const orderGid = canonical.event.refs.allocatedOrderId
            if (orderGid) {
              lastSeq =
                this.refreshOrderFromPayments(orderGid, canonical.event, device.id, now) ?? lastSeq
            }
          }
        }
        // Sau sổ chính, chỉ kiểm hình dạng: trên máy cục bộ gid treo giữa món và nhóm là trạng thái hợp lệ (đọc thì
        // ẩn), từ chối ở đây là chặn ghép máy mãi mãi.
        for (const source of catalog) {
          const entity = `${source.table}:${source.entityKey}`
          if (
            source.operation !== 'create' ||
            source.before !== null ||
            eventIds.has(source.eventId) ||
            entities.has(entity)
          ) {
            throw new SeedRejected('Ảnh sổ ban đầu có sự kiện trùng hoặc không phải bản ghi tạo mới.')
          }
          eventIds.add(source.eventId)
          entities.add(entity)
          const validated = this.validateCatalogEvent(source)
          if ('problem' in validated) throw new SeedRejected(validated.problem)
          this.appendCatalogEvent(validated.event, device.id, now)
        }
        if (admission.expectedRows > 0) {
          const promotedRows = this.countLedgerRows()
          if (promotedRows !== admission.expectedRows) {
            throw new SeedRejected('Không promote đủ toàn bộ ảnh sổ ban đầu.')
          }
        }
        this.sql.exec('UPDATE pairCodes SET usedAt = ? WHERE codeHash = ?', now, admission.codeHash)
        this.sql.exec('DELETE FROM ledgerAdmission WHERE deviceId = ?', device.id)
        return { ok: true, lastSeq }
      })

      if (!result.ok) {
        return json(
          { error: result.error, message: result.message },
          result.error === 'unauthorized' ? 401 : 409,
        )
      }
      for (const socket of this.ctx.getWebSockets()) {
        socket.send(JSON.stringify({ type: 'oplog', seq: result.lastSeq }))
      }
      return json({ activated: true, lastSeq: result.lastSeq }, 201)
    } catch (caught) {
      if (caught instanceof SeedRejected) {
        return json({ error: 'business-rejected', message: caught.message }, 409)
      }
      throw caught
    }
  }

  /** Sổ chính và danh mục cùng là "dữ liệu sổ" của lượt ghép: máy đếm cả hai khi báo `localLedgerRows`. */
  private countLedgerRows(): number {
    const count = (table: 'ledger' | 'catalogLedger') =>
      Number(first(this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`))?.count) || 0
    return count('ledger') + count('catalogLedger')
  }

  private async getOplog(request: Request): Promise<Response> {
    const device = await this.authenticate(request)
    if (!device) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const url = new URL(request.url)
    const since = Number(url.searchParams.get('since') ?? 0)
    if (!Number.isInteger(since) || since < 0) return json({ error: 'invalid-request' }, 400)
    this.recordPullProgress(device.id, since)
    const rows = [...this.sql.exec<{ seq: number; payload: string }>(
      'SELECT seq, payload FROM oplog WHERE seq > ? ORDER BY seq ASC LIMIT 500',
      since,
    )]
    return json({ events: rows.map((row) => JSON.parse(row.payload)), hasMore: rows.length === 500 })
  }

  private shopIdentity(): { shopId: string; createdAt: number } {
    const row = first(this.sql.exec<{ shopId: string; createdAt: number }>('SELECT id AS shopId, createdAt FROM shop LIMIT 1'))
    if (!row) throw new Error('Shop chưa được khởi tạo.')
    return { shopId: row.shopId, createdAt: row.createdAt }
  }

  private adminIdentity(): Response {
    return json(this.shopIdentity())
  }

  private adminOverview(url: URL): Response {
    const devices = [...this.sql.exec<DeviceOverview>(
      'SELECT d.id, d.letter, d.label, d.createdAt, d.revokedAt, a.lastSeenAt, a.pulledSeq, a.rewoundAt FROM devices d LEFT JOIN deviceActivity a ON a.deviceId = d.id ORDER BY d.createdAt',
    )].map((device) => ({
      id: device.id,
      letter: device.letter,
      label: device.label,
      createdAt: device.createdAt,
      revokedAt: device.revokedAt,
      lastSeenAt: device.lastSeenAt,
      pulledSeq: device.pulledSeq,
      rewoundAt: device.rewoundAt,
    }))
    const latestSeq =
      Number(first(this.sql.exec<{ seq: number }>('SELECT MAX(seq) AS seq FROM oplog'))?.seq) || 0
    const settings = first(
      this.sql.exec<LedgerRow>("SELECT payload FROM ledger WHERE tableName = 'settings' AND entityKey = 'shop'"),
    )
    const shopValue = settings ? parseAfterRefs(settings.payload).after : null
    const value = isRecord(shopValue) ? shopValue.value : null
    const shopName = isRecord(value) && typeof value.name === 'string' ? value.name : null

    const rows = [...this.sql.exec<{ tableName: string; entityKey: string; payload: string }>(
      "SELECT tableName, entityKey, payload FROM ledger WHERE tableName IN ('orders', 'payments', 'customers')",
    )]
    const { debts, ...summary } = summarizeServerLedger(rows)
    const overview: ShopOverview = { ...this.shopIdentity(), shopName, latestSeq, devices, summary }
    if (url.searchParams.get('debts') !== '1') return json(overview)

    const customerNames = new Map<string, string>()
    for (const row of rows) {
      if (row.tableName !== 'customers') continue
      const after = parseAfterRefs(row.payload).after
      if (isRecord(after) && typeof after.name === 'string') customerNames.set(row.entityKey, after.name)
    }
    const named: ShopDebt[] = debts.map((debt) => ({
      customerGid: debt.customerGid,
      name: customerNames.get(debt.customerGid) ?? null,
      total: debt.total,
      orderCount: debt.orderCount,
      oldestAt: debt.oldestAt,
    }))
    const detail: ShopDetail = { ...overview, debts: named }
    return json(detail)
  }

  private adminData(url: URL): Response {
    const rawTable = url.searchParams.get('table')
    const catalogTable = CatalogTableSchema.safeParse(rawTable)
    const table = catalogTable.success ? catalogTable : LedgerTableSchema.safeParse(rawTable)
    const after = nonNegativeInteger(url.searchParams.get('after') ?? '0')
    const limit = nonNegativeInteger(url.searchParams.get('limit'))
    if (!table.success || after === null || limit === null || limit < 1 || limit > ADMIN_DATA_MAX_LIMIT) {
      return json({ error: 'invalid-request' }, 400)
    }

    let rows: { entityKey: string; updatedSeq: number; payload: string }[]
    const rawOrderIds = url.searchParams.get('orderIds')
    if (rawOrderIds === null) {
      // `updatedSeq` của danh mục là seq luồng danh mục — con trỏ trang vẫn đúng vì chỉ so trong cùng một bảng.
      rows = [...this.sql.exec<{ entityKey: string; updatedSeq: number; payload: string }>(
        `SELECT entityKey, updatedSeq, payload FROM ${catalogTable.success ? 'catalogLedger' : 'ledger'} WHERE tableName = ? AND updatedSeq > ? ORDER BY updatedSeq LIMIT ?`,
        table.data,
        after,
        limit,
      )]
    } else {
      const orderIds = rawOrderIds.split(',')
      if (
        table.data !== 'orderLines' ||
        orderIds.length > ADMIN_ORDER_IDS_MAX ||
        !orderIds.every((id) => UUID_PATTERN.test(id))
      ) {
        return json({ error: 'invalid-request' }, 400)
      }
      // Một câu cho cả trang đơn: màn admin không được gọi theo từng đơn, mỗi lần gọi tốn một request DO.
      rows = [...this.sql.exec<{ entityKey: string; updatedSeq: number; payload: string }>(
        `SELECT entityKey, updatedSeq, payload FROM ledger WHERE tableName = 'orderLines' AND updatedSeq > ? AND json_extract(payload, '$.refs.orderId') IN (${orderIds.map(() => '?').join(', ')}) ORDER BY updatedSeq LIMIT ?`,
        after,
        ...orderIds,
        limit,
      )]
    }

    const page: AdminDataPage = {
      rows: rows.map((row) => ({ entityKey: row.entityKey, updatedSeq: row.updatedSeq, ...parseAfterRefs(row.payload) })),
      next: rows.length === limit ? (rows[rows.length - 1]?.updatedSeq ?? null) : null,
    }
    return json(page)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/internal/bootstrap') {
      return this.bootstrap(request)
    }
    if (!(await this.isInitialized())) return json({ error: 'shop-not-found' }, 404)
    this.ensureAdminSchema()
    this.ensureCatalogSchema()

    if (request.method === 'POST' && url.pathname === '/pair') return this.pair(request)
    if (request.method === 'POST' && url.pathname === '/pair-code') return this.createPairCode(request)
    if (request.method === 'GET' && url.pathname === '/devices') return this.listDevices(request)
    if (request.method === 'GET' && url.pathname === '/ws') return this.openSocket(request)
    if (request.method === 'POST' && url.pathname === '/epoch') return this.claimEpoch(request)
    if (request.method === 'POST' && url.pathname === '/events') return this.acceptEvent(request)
    if (request.method === 'POST' && url.pathname === '/seed') return this.activateDevice(request)
    if (request.method === 'GET' && url.pathname === '/oplog') return this.getOplog(request)
    if (request.method === 'POST' && url.pathname === '/catalog/events') return this.acceptCatalogEvent(request)
    if (request.method === 'GET' && url.pathname === '/catalog/oplog') return this.getCatalogOplog(request)
    if (request.method === 'GET' && url.pathname === '/internal/admin/identity') return this.adminIdentity()
    if (request.method === 'GET' && url.pathname === '/internal/admin/overview') return this.adminOverview(url)
    if (request.method === 'GET' && url.pathname === '/internal/admin/data') return this.adminData(url)

    const revoke = url.pathname.match(/^\/devices\/([^/]+)\/revoke$/)
    if (request.method === 'POST' && revoke?.[1]) {
      let deviceId: string
      try {
        deviceId = decodeURIComponent(revoke[1])
      } catch {
        return new Response('Not found', { status: 404 })
      }
      return this.revokeDevice(request, deviceId)
    }
    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') socket.send('pong')
  }
}
