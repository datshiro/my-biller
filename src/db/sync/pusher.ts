import type { Transaction } from 'dexie'
import { db, verbatimWrites } from '../db'
import { getDeviceSyncState } from '../repositories/device-state'
import { pushEvent, SyncApiError } from './client'
import { assertLeadership, type LeaderToken } from './leader'
import { resolveItemNameTaken } from './item-name-taken'
import { OUTBOX_CHANGED_EVENT, type OutboxRow } from './outbox'
import { DeviceNoticeSchema, type DeviceConnection } from '@/domain/schema'
import { LEDGER_TABLE_NAMES, SyncEventSchema } from '@shared/sync-events'

// Không lặp nóng khi món có sẵn mãi chưa về máy: chỉ bắn sự kiện một lần cho mỗi dòng, chờ nhịp kéo kế
// tiếp (`runner.ts`) tự chạy lại. Không `import` từ `runner.ts` — runner đã `import` pusher, tránh vòng.
const deferredOnce = new Set<string>()

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

export async function restoreRow(transaction: Transaction, row: OutboxRow): Promise<boolean> {
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
    verbatimWrites.add(transaction)
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

    // Thứ tự `id` outbox không chắc trùng `txOrder` của một lần ghi (món không nhóm vào outbox ngay,
    // món có nhóm phải chờ một lượt `get` gid nhóm), nên câu báo không nêu số thay đổi ĐÃ lên — chỉ đếm
    // đúng trên đuôi bị hoàn lại (`sameTx`, `later`), luôn chính xác bất kể thứ tự đẩy.
    const sameTx = tail.filter((row) => row.txId === rejected.txId).length
    const later = new Set(tail.filter((row) => row.txId !== rejected.txId).map((row) => row.txId)).size
    const reasonMessage =
      sameTx === 1 && rejected.txOrder === 0
        ? `${reason} Thay đổi này và ${later} thao tác làm sau đã được hoàn lại.`
        : `${reason} Lần ghi này bị từ chối ở giữa: ${sameTx} thay đổi của nó` +
          (later > 0 ? ` và ${later} thao tác làm sau` : '') +
          ' đã được hoàn lại trên máy này; các thay đổi khác của lần ghi đó (nếu có) đã lên sổ chung.'
    await db.deviceState.put(
      DeviceNoticeSchema.parse({
        key: 'notice',
        id: crypto.randomUUID(),
        message: conflict
          ? `${reason} Dữ liệu trên máy đã đổi tiếp nên app sẽ kéo lại sổ chung.`
          : reasonMessage,
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
    if (caught instanceof SyncApiError && caught.code === 'item-name-taken') {
      const detail = caught.detail as { existingGid?: unknown; existingName?: unknown } | undefined
      if (typeof detail?.existingGid !== 'string' || typeof detail.existingName !== 'string') {
        // Hợp đồng thiếu existingGid/existingName (lệch phiên bản Worker/app) — coi như chưa xử lý được,
        // không đoán mò nối sai món; chờ nhịp kéo rồi thử lại như trường hợp 'deferred'.
        if (!deferredOnce.has(row.eventId)) {
          deferredOnce.add(row.eventId)
          if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT))
        }
        return 'empty'
      }
      const outcome = await resolveItemNameTaken(row, detail.existingGid, detail.existingName, leader)
      if (outcome === 'resolved') return 'pushed'
      if (!deferredOnce.has(row.eventId)) {
        deferredOnce.add(row.eventId)
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT))
      }
      return 'empty'
    }
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
