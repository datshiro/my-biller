import type { Transaction } from 'dexie'
import { db } from '../db'
import { assertLeadership, type LeaderToken } from './leader'
import { getDeviceSyncState } from '../repositories/device-state'
import { LEDGER_TABLE_NAMES, ServerEventSchema, type LedgerTableName, type ServerEvent } from '@shared/sync-events'
import { safeParseLedgerPayload, safeParseLedgerRow } from '@shared/ledger-schemas'

const parentTableByField: Record<string, LedgerTableName> = {
  groupId: 'itemGroups',
  customerId: 'customers',
  itemId: 'items',
  orderId: 'orders',
  allocatedOrderId: 'orders',
  categoryId: 'expenseCategories',
}

async function rowByEntity(transaction: Transaction, table: LedgerTableName, entityKey: string) {
  if (table === 'settings') return transaction.table(table).get(entityKey)
  return transaction.table(table).where('gid').equals(entityKey).first()
}

async function localize(
  transaction: Transaction,
  event: ServerEvent,
): Promise<Record<string, unknown>> {
  const localized = structuredClone(event.after ?? {})
  delete localized.id
  for (const [field, parentGid] of Object.entries(event.refs)) {
    if (parentGid === null) {
      localized[field] = field === 'allocatedOrderId' ? 0 : null
      continue
    }
    const parentTable = parentTableByField[field]
    const parent = parentTable
      ? ((await rowByEntity(transaction, parentTable, parentGid)) as { id?: number } | undefined)
      : undefined
    if (!parent?.id) throw new Error(`Thiếu bản ghi cha ${parentTable ?? field} (${parentGid}).`)
    localized[field] = parent.id
  }
  return localized
}

async function applyOne(transaction: Transaction, event: ServerEvent): Promise<void> {
  const table = transaction.table(event.table)
  const existing = (await rowByEntity(transaction, event.table, event.entityKey)) as
    | { id?: number; key?: string }
    | undefined
  if (event.operation === 'delete') {
    if (event.table === 'settings') await table.delete(event.entityKey)
    else if (existing?.id !== undefined) await table.delete(existing.id)
    return
  }

  const localized = await localize(transaction, event)
  const parsed = safeParseLedgerRow(event.table, localized)
  if (!parsed.success) throw new Error(`Dữ liệu bảng ${event.table} từ sổ chung không hợp lệ.`)
  if (event.table === 'settings') await table.put(parsed.data)
  else {
    await table.put(existing?.id === undefined ? parsed.data : { ...parsed.data, id: existing.id })
  }
}

function parseServerEvent(raw: ServerEvent): ServerEvent {
  const event = ServerEventSchema.parse(raw)
  const parsePayload = (payload: Record<string, unknown> | null) => {
    if (payload === null) return { success: true as const, data: null }
    return safeParseLedgerPayload(event.table, payload)
  }
  const before = parsePayload(event.before)
  const after = parsePayload(event.after)
  const requiredPayload = event.operation === 'delete' ? before : after
  if (!before.success || !after.success || !requiredPayload.success || requiredPayload.data === null) {
    throw new Error(`Dữ liệu bảng ${event.table} từ sổ chung không hợp lệ.`)
  }
  return { ...event, before: before.data, after: after.data }
}

export async function applyEvents(events: readonly ServerEvent[], leader: LeaderToken): Promise<void> {
  if (events.length === 0) return
  const parsed = events.map(parseServerEvent).sort((a, b) => a.seq - b.seq)
  const tables = LEDGER_TABLE_NAMES.map((name) => db.table(name))

  await db.transaction('rw', [...tables, db.deviceState], async (transaction) => {
    await assertLeadership(db, leader)
    const sync = await getDeviceSyncState()
    let lastSeq = sync.lastSeq
    let changed = false
    for (const event of parsed) {
      if (event.seq <= lastSeq) continue
      if (event.seq !== lastSeq + 1) throw new Error(`Thiếu sự kiện giữa seq ${lastSeq} và ${event.seq}.`)
      await applyOne(transaction, event)
      lastSeq = event.seq
      changed = true
    }
    await assertLeadership(db, leader)
    if (changed) {
      await db.deviceState.put({
        ...sync,
        lastSeq,
        revision: sync.revision + 1,
        lastConnectedAt: Date.now(),
      })
    }
  })
}

export async function resetReadReplica(leader: LeaderToken): Promise<void> {
  const tables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  await db.transaction('rw', [...tables, db.deviceState, db.outbox], async () => {
    await assertLeadership(db, leader)
    if ((await db.outbox.count()) > 0) {
      throw new Error('Còn thay đổi chưa lên sổ chung; chưa thể kéo lại từ đầu.')
    }
    await Promise.all(tables.map((table) => table.clear()))
    const sync = await getDeviceSyncState()
    await db.deviceState.put({
      ...sync,
      lastSeq: 0,
      revision: sync.revision + 1,
      resyncRequired: false,
    })
    await assertLeadership(db, leader)
  })
}

export async function requestFullResync(): Promise<void> {
  await db.transaction('rw', db.deviceState, db.outbox, async () => {
    if ((await db.outbox.count()) > 0) {
      throw new Error('Còn thay đổi chưa lên sổ chung. Chờ đồng bộ xong rồi kéo lại.')
    }
    const sync = await getDeviceSyncState()
    await db.deviceState.put({ ...sync, resyncRequired: true })
  })
}
