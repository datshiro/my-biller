import Dexie, { type Table, type Transaction } from 'dexie'
import type { BillerDb } from '../db'
import { db } from '../db'
import {
  LEDGER_TABLE_NAMES,
  type LedgerTableName,
  type SyncEvent,
  type SyncOperation,
} from '@shared/sync-events'

export type OutboxRow = SyncEvent & {
  id?: number
  localId: number | string | null
  status: 'pending'
  createdAt: number
}

type CaptureContext = {
  enabled: boolean
  txId: string
  nextOrder: number
  pending: Promise<unknown>[]
}

const contexts = new WeakMap<Transaction, CaptureContext>()
const installed = new WeakSet<BillerDb>()

export const OUTBOX_CHANGED_EVENT = 'my-biller:outbox-changed'

const clone = (value: Record<string, unknown> | null) =>
  value === null ? null : structuredClone(value)

function entityOf(
  table: LedgerTableName,
  row: Record<string, unknown> | null,
): { entityKey: string; entityGid: string | null } | null {
  if (!row) return null
  if (table === 'settings') {
    return typeof row.key === 'string' ? { entityKey: row.key, entityGid: null } : null
  }
  return typeof row.gid === 'string' ? { entityKey: row.gid, entityGid: row.gid } : null
}

function withoutLocalId(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  const copy = clone(row)!
  delete copy.id
  return copy
}

async function gidFor(
  transaction: Transaction,
  table: LedgerTableName,
  id: unknown,
): Promise<string | null> {
  if (id === null || id === undefined || id === 0) return null
  const row = (await transaction.table(table).get(id)) as { gid?: unknown } | undefined
  return typeof row?.gid === 'string' ? row.gid : null
}

async function refsFor(
  transaction: Transaction,
  table: LedgerTableName,
  row: Record<string, unknown> | null,
): Promise<Record<string, string | null>> {
  if (!row) return {}
  switch (table) {
    case 'items':
      return { groupId: await gidFor(transaction, 'itemGroups', row.groupId) }
    case 'customerPrices':
      return {
        customerId: await gidFor(transaction, 'customers', row.customerId),
        itemId: await gidFor(transaction, 'items', row.itemId),
      }
    case 'orders':
      return { customerId: await gidFor(transaction, 'customers', row.customerId) }
    case 'orderLines':
      return {
        orderId: await gidFor(transaction, 'orders', row.orderId),
        itemId: await gidFor(transaction, 'items', row.itemId),
      }
    case 'payments':
      return {
        orderId: await gidFor(transaction, 'orders', row.orderId),
        allocatedOrderId: await gidFor(transaction, 'orders', row.allocatedOrderId),
        customerId: await gidFor(transaction, 'customers', row.customerId),
      }
    case 'expenses':
      return { categoryId: await gidFor(transaction, 'expenseCategories', row.categoryId) }
    default:
      return {}
  }
}

function applyModifications(
  original: Record<string, unknown>,
  modifications: Record<string, unknown>,
): Record<string, unknown> {
  const after = clone(original)!
  for (const [keyPath, value] of Object.entries(modifications)) {
    Dexie.setByKeyPath(after, keyPath, value)
  }
  return after
}

function capture(
  transaction: Transaction,
  table: LedgerTableName,
  operation: SyncOperation,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  localId: number | string | null,
): void {
  const context = contexts.get(transaction)
  if (!context?.enabled) return
  const entity = entityOf(table, after ?? before)
  if (!entity) throw new Error(`Không tìm thấy gid/key để đồng bộ bảng ${table}.`)

  const txOrder = context.nextOrder++
  const eventId = crypto.randomUUID()
  const promise = refsFor(transaction, table, after ?? before).then((refs) =>
    transaction.table<OutboxRow, number>('outbox').add({
      eventId,
      txId: context.txId,
      txOrder,
      table,
      ...entity,
      operation,
      before: withoutLocalId(before),
      after: withoutLocalId(after),
      refs,
      localId,
      status: 'pending',
      createdAt: Date.now(),
    }),
  )
  context.pending.push(promise)
}

export function installOutboxHooks(database: BillerDb): void {
  if (installed.has(database)) return
  installed.add(database)

  for (const tableName of LEDGER_TABLE_NAMES) {
    const table = database.table(tableName) as Table<Record<string, unknown>, unknown>
    table.hook('creating', (key, object, transaction) => {
      capture(transaction, tableName, 'create', null, clone(object), (key as number | string | undefined) ?? null)
    })
    table.hook('updating', (modifications, _key, object, transaction) => {
      capture(
        transaction,
        tableName,
        'put',
        clone(object),
        applyModifications(object, modifications as Record<string, unknown>),
        _key as number | string,
      )
    })
    table.hook('deleting', (_key, object, transaction) => {
      capture(transaction, tableName, 'delete', clone(object), null, _key as number | string)
    })
  }
}

export async function syncTransaction<T>(callback: () => Promise<T> | T): Promise<T> {
  const ledgerTables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  let notifyRunner = false
  const result = await db.transaction(
    'rw',
    [...ledgerTables, db.deviceState, db.outbox],
    async (transaction) => {
      const pairing = await db.deviceState.get('pairing')
      if (
        pairing?.key === 'pairing' &&
        (pairing.connectionSaved || pairing.expiresAt > Date.now())
      ) {
        throw new Error('Máy đang ghép vào sổ chung. Chờ ghép xong rồi ghi tiếp.')
      }
      if (pairing?.key === 'pairing') await db.deviceState.delete('pairing')
      const writeBlock = await db.deviceState.get('writeBlock')
      if (writeBlock?.key === 'writeBlock' && writeBlock.reason === 'revoked') {
        throw new Error('Máy này đã bị thu hồi. Hãy ghép lại trước khi ghi thêm vào sổ.')
      }
      const sync = await db.deviceState.get('sync')
      if (sync?.key === 'sync' && sync.resyncRequired) {
        throw new Error('Máy đang kéo lại sổ chung. Chờ đồng bộ xong rồi ghi tiếp.')
      }
      const enabled = (await db.deviceState.get('connection')) !== undefined
      const context: CaptureContext = {
        enabled,
        txId: crypto.randomUUID(),
        nextOrder: 0,
        pending: [],
      }
      contexts.set(transaction, context)
      try {
        const value = await callback()
        await Promise.all(context.pending)
        notifyRunner = enabled && context.pending.length > 0
        return value
      } finally {
        contexts.delete(transaction)
      }
    },
  )
  if (notifyRunner && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT))
  }
  return result
}

export function listPendingOutbox(): Promise<OutboxRow[]> {
  return db.outbox.orderBy('id').toArray()
}

export async function countPendingOperations(): Promise<number> {
  const rows = await db.outbox.toArray()
  return new Set(rows.map((row) => row.txId)).size
}

export async function stageExistingLedger(transaction: Transaction): Promise<number> {
  await transaction.table('outbox').clear()
  const txId = crypto.randomUUID()
  let txOrder = 0
  for (const tableName of LEDGER_TABLE_NAMES) {
    const rows = (await transaction.table(tableName).toArray()) as Record<string, unknown>[]
    for (const row of rows) {
      const entity = entityOf(tableName, row)
      if (!entity) throw new Error(`Không tìm thấy gid/key khi nạp bảng ${tableName}.`)
      await transaction.table('outbox').add({
        eventId: crypto.randomUUID(),
        txId,
        txOrder: txOrder++,
        table: tableName,
        ...entity,
        operation: 'create',
        before: null,
        after: withoutLocalId(row),
        refs: await refsFor(transaction, tableName, row),
        localId:
          typeof row.id === 'number' || typeof row.key === 'string'
            ? ((row.id ?? row.key) as number | string)
            : null,
        status: 'pending',
        createdAt: Date.now(),
      })
    }
  }
  return txOrder
}
