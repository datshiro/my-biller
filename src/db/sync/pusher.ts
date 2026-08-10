import type { Transaction } from 'dexie'
import { db } from '../db'
import { getDeviceSyncState } from '../repositories/device-state'
import { pushEvent, SyncApiError } from './client'
import { assertLeadership, type LeaderToken } from './leader'
import type { OutboxRow } from './outbox'
import { DeviceNoticeSchema, type DeviceConnection } from '@/domain/schema'
import { LEDGER_TABLE_NAMES, SyncEventSchema } from '@shared/sync-events'

const normalized = (row: Record<string, unknown> | null | undefined) => {
  if (!row) return null
  const copy = structuredClone(row)
  delete copy.id
  return copy
}

const same = (
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))

async function currentRow(transaction: Transaction, row: OutboxRow) {
  const table = transaction.table(row.table)
  return row.table === 'settings'
    ? table.get(row.entityKey)
    : table.where('gid').equals(row.entityKey).first()
}

async function restoreRow(transaction: Transaction, row: OutboxRow): Promise<boolean> {
  const table = transaction.table(row.table)
  const current = (await currentRow(transaction, row)) as Record<string, unknown> | undefined
  if (!same(current, row.after)) return false

  if (row.before === null) {
    if (row.table === 'settings') await table.delete(row.entityKey)
    else if (current?.id !== undefined) await table.delete(current.id)
    return true
  }

  const restored = structuredClone(row.before)
  if (row.table !== 'settings' && row.localId !== null) restored.id = row.localId
  await table.put(restored)
  return true
}

export async function rollbackRejectedTail(
  rejected: OutboxRow,
  leader: LeaderToken,
  reason: string,
): Promise<void> {
  const tables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  await db.transaction('rw', [...tables, db.outbox, db.deviceState], async (transaction) => {
    await assertLeadership(db, leader)
    const tail = (await db.outbox.toArray())
      .filter((row) => (row.id ?? 0) >= (rejected.id ?? 0))
      .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
    let conflict = false
    for (const row of tail) {
      if (!(await restoreRow(transaction, row))) conflict = true
    }
    await db.outbox.bulkDelete(tail.flatMap((row) => (row.id === undefined ? [] : [row.id])))

    const sync = await getDeviceSyncState()
    await db.deviceState.put({ ...sync, resyncRequired: sync.resyncRequired || conflict })
    await db.deviceState.put(
      DeviceNoticeSchema.parse({
        key: 'notice',
        id: crypto.randomUUID(),
        message: conflict
          ? `${reason} Dữ liệu trên máy đã đổi tiếp nên app sẽ kéo lại sổ chung.`
          : `${reason} Thay đổi này và ${Math.max(0, new Set(tail.map((row) => row.txId)).size - 1)} thao tác làm sau đã được hoàn lại.`,
        createdAt: Date.now(),
      }),
    )
    await assertLeadership(db, leader)
  })
}

export async function pushNext(
  connection: DeviceConnection,
  leader: LeaderToken,
): Promise<'empty' | 'pushed'> {
  const row = await db.outbox.orderBy('id').first()
  if (!row) return 'empty'

  try {
    await pushEvent(connection, leader.epoch, SyncEventSchema.parse(row))
  } catch (caught) {
    if (caught instanceof SyncApiError && caught.code === 'stale-leader') throw caught
    if (caught instanceof SyncApiError && caught.code === 'business-rejected') {
      await rollbackRejectedTail(row, leader, caught.message)
      return 'pushed'
    }
    throw caught
  }

  await db.transaction('rw', db.outbox, db.deviceState, async () => {
    await assertLeadership(db, leader)
    if (row.id !== undefined) await db.outbox.delete(row.id)
  })
  return 'pushed'
}

export async function drainOutbox(connection: DeviceConnection, leader: LeaderToken): Promise<void> {
  while ((await pushNext(connection, leader)) === 'pushed') {
    // Cố ý tuần tự: thứ tự sự kiện là hợp đồng cha-trước-con và tiền-trước-phân-bổ.
  }
}
