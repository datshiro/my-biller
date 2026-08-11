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
import { safeParseLedgerPayload } from '../../shared/ledger-schemas'

const INITIALIZED_KEY = 'initialized'
const PAIR_TTL_MS = 5 * 60 * 1000
const PAIR_ADMISSION_TTL_MS = 2 * 60 * 1000
const PAIR_FAILURE_LIMIT = 8
const PAIR_LOCK_MS = 5 * 60 * 1000

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

const json = (body: unknown, status = 200) => Response.json(body, { status })

function first<T>(rows: Iterable<T>): T | undefined {
  return rows[Symbol.iterator]().next().value as T | undefined
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
      `)
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

      const serverHasLedger =
        Number(first(this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM ledger'))?.count) > 0
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
    return json({ devices })
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

  private canonicalizeEvent(event: SyncEvent): { event: SyncEvent } | { problem: string } {
    const validated = this.validateEventPayloads(event)
    if ('problem' in validated) return validated
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

  private async acceptEvent(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const parsed = SyncEventSchema.safeParse(body?.event)
    const epoch = typeof body?.epoch === 'number' && Number.isInteger(body.epoch) ? body.epoch : 0
    if (!parsed.success || epoch <= 0) return json({ error: 'invalid-request' }, 400)

    const serverAt = Date.now()
    const proposed = this.stampServerTime(parsed.data, serverAt)
    const result = this.ctx.storage.transactionSync<
      | { ok: true; seq: number; notifySeq: number; duplicate: boolean }
      | { ok: false; error: 'unauthorized' | 'stale-leader' | 'business-rejected' | 'seed-in-progress'; message: string }
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
      const deleteProblem = this.deleteProblem(referenced.event)
      if (deleteProblem) {
        return { ok: false, error: 'business-rejected', message: deleteProblem }
      }
      const canonical = this.canonicalizeEvent(referenced.event)
      if ('problem' in canonical) {
        return { ok: false, error: 'business-rejected', message: canonical.problem }
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
      return json(
        { error: result.error, message: result.message },
        result.error === 'unauthorized' ? 401 : 409,
      )
    }
    if (!result.duplicate) {
      for (const socket of this.ctx.getWebSockets()) {
        socket.send(JSON.stringify({ type: 'oplog', seq: result.notifySeq }))
      }
    }
    return json({ seq: result.seq, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
  }

  private async activateDevice(request: Request): Promise<Response> {
    const [tokenHash, body] = await Promise.all([this.requestTokenHash(request), readJson(request)])
    if (!tokenHash) {
      return json({ error: 'unauthorized', message: 'Lượt ghép máy không còn hiệu lực.' }, 401)
    }
    if (!Array.isArray(body?.events)) return json({ error: 'invalid-request' }, 400)
    const parsed: SyncEvent[] = []
    for (const raw of body.events) {
      const event = SyncEventSchema.safeParse(raw)
      if (!event.success) return json({ error: 'invalid-request' }, 400)
      parsed.push(event.data)
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
        if (parsed.length !== admission.expectedRows) {
          return {
            ok: false,
            error: 'seed-incomplete',
            message: `Ảnh sổ có ${parsed.length}/${admission.expectedRows} dòng; chưa kích hoạt máy.`,
          }
        }
        const ledgerRows =
          Number(first(this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM ledger'))?.count) || 0
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
        if (admission.expectedRows > 0) {
          const promotedRows =
            Number(first(this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM ledger'))?.count) || 0
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

  private async getOplog(request: Request): Promise<Response> {
    const device = await this.authenticate(request)
    if (!device) return json({ error: 'unauthorized', message: 'Máy này chưa ghép hoặc đã bị thu hồi.' }, 401)
    const url = new URL(request.url)
    const since = Number(url.searchParams.get('since') ?? 0)
    if (!Number.isInteger(since) || since < 0) return json({ error: 'invalid-request' }, 400)
    const rows = [...this.sql.exec<{ seq: number; payload: string }>(
      'SELECT seq, payload FROM oplog WHERE seq > ? ORDER BY seq ASC LIMIT 500',
      since,
    )]
    return json({ events: rows.map((row) => JSON.parse(row.payload)), hasMore: rows.length === 500 })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/internal/bootstrap') {
      return this.bootstrap(request)
    }
    if (!(await this.isInitialized())) return json({ error: 'shop-not-found' }, 404)

    if (request.method === 'POST' && url.pathname === '/pair') return this.pair(request)
    if (request.method === 'POST' && url.pathname === '/pair-code') return this.createPairCode(request)
    if (request.method === 'GET' && url.pathname === '/devices') return this.listDevices(request)
    if (request.method === 'GET' && url.pathname === '/ws') return this.openSocket(request)
    if (request.method === 'POST' && url.pathname === '/epoch') return this.claimEpoch(request)
    if (request.method === 'POST' && url.pathname === '/events') return this.acceptEvent(request)
    if (request.method === 'POST' && url.pathname === '/seed') return this.activateDevice(request)
    if (request.method === 'GET' && url.pathname === '/oplog') return this.getOplog(request)

    const revoke = url.pathname.match(/^\/devices\/([^/]+)\/revoke$/)
    if (request.method === 'POST' && revoke?.[1]) {
      return this.revokeDevice(request, decodeURIComponent(revoke[1]))
    }
    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') socket.send('pong')
  }
}
