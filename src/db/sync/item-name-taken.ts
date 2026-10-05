import type { Transaction } from 'dexie'
import { db, verbatimWrites } from '../db'
import { getDeviceSyncState } from '../repositories/device-state'
import { assertLeadership, type LeaderToken } from './leader'
import { restoreRow } from './pusher'
import type { OutboxRow } from './outbox'
import { formatVnd } from '@/domain/money'
import { DeviceNoticeSchema } from '@/domain/schema'
import { LEDGER_TABLE_NAMES } from '@shared/sync-events'

type ItemRow = { id: number; gid: string; name: string; unitPrice: number; isActive: 0 | 1 }
type CustomerPriceRow = { id: number; gid: string; customerId: number; itemId: number; unitPrice: number }

async function notice(message: string): Promise<void> {
  await db.deviceState.put(
    DeviceNoticeSchema.parse({ key: 'notice', id: crypto.randomUUID(), message, createdAt: Date.now() }),
  )
}

async function markResyncIfConflict(conflict: boolean): Promise<void> {
  if (!conflict) return
  const sync = await getDeviceSyncState()
  await db.deviceState.put({ ...sync, resyncRequired: true })
}

/** `dLocalId` không đến từ `rejected.localId` (luôn `null` cho sự kiện `create` của bảng `++id`) mà từ
 * dòng hiện tại trên bảng (D còn sống) hoặc một sự kiện `put`/`delete` sau đó của D (mang khoá thật). */
async function resolveDLocalId(dGid: string): Promise<number | null> {
  const current = (await db.items.where('gid').equals(dGid).first()) as ItemRow | undefined
  if (current?.id !== undefined) return current.id
  const outboxRows = (await db.outbox.toArray()) as OutboxRow[]
  const withLocalId = outboxRows.find(
    (row) => row.table === 'items' && row.entityKey === dGid && row.localId !== null,
  )
  return typeof withLocalId?.localId === 'number' ? withLocalId.localId : null
}

async function resolveCreate(
  rejected: OutboxRow,
  existing: ItemRow,
  existingName: string,
): Promise<void> {
  const dGid = rejected.entityKey
  const dLocalId = await resolveDLocalId(dGid)
  const tenLucTao = String(rejected.after?.name ?? '')

  // Nếu `put` sau đó đã đổi tên D trước khi bị gộp (L-8), ghi lại tên cuối cho câu báo.
  const laterItemPuts = ((await db.outbox.toArray()) as OutboxRow[]).filter(
    (row) => row.table === 'items' && row.entityKey === dGid && row.operation === 'put',
  )
  const tenCuoi =
    laterItemPuts.length > 0 ? String(laterItemPuts.at(-1)!.after?.name ?? tenLucTao) : null

  // 3. Bỏ khỏi outbox mọi dòng của D (chính `rejected` và mọi `put`/`delete` sau đó).
  const dItemEventIds = new Set(
    ((await db.outbox.toArray()) as OutboxRow[])
      .filter((row) => row.table === 'items' && row.entityKey === dGid)
      .map((row) => row.id)
      .filter((id): id is number => id !== undefined),
  )
  await db.outbox.bulkDelete([...dItemEventIds])

  // 4. Giá riêng: gom thực thể customerPrices liên quan tới D (qua outbox refs.itemId hoặc dòng cục bộ itemId).
  const remainingAfterItemPurge = (await db.outbox.toArray()) as OutboxRow[]
  const cpOutboxForD = remainingAfterItemPurge.filter(
    (row) => row.table === 'customerPrices' && row.refs.itemId === dGid,
  )
  const cpLocalForD =
    dLocalId !== null
      ? ((await db.customerPrices.where('itemId').equals(dLocalId).toArray()) as CustomerPriceRow[])
      : []
  const cpEntityKeys = new Set([
    ...cpOutboxForD.map((row) => row.entityKey),
    ...cpLocalForD.map((row) => row.gid),
  ])

  let droppedPrices = 0
  for (const entityKey of cpEntityKeys) {
    const localRow = cpLocalForD.find((row) => row.gid === entityKey)
    const latestEvent = cpOutboxForD.filter((row) => row.entityKey === entityKey).at(-1)
    const customerId =
      localRow?.customerId ??
      Number((latestEvent?.after ?? latestEvent?.before)?.customerId)
    if (!Number.isFinite(customerId)) continue

    const conflict = (await db.customerPrices
      .where('[customerId+itemId]')
      .equals([customerId, existing.id])
      .first()) as CustomerPriceRow | undefined
    if (conflict) {
      droppedPrices++
      const eventIds = cpOutboxForD
        .filter((row) => row.entityKey === entityKey)
        .map((row) => row.id)
        .filter((id): id is number => id !== undefined)
      await db.outbox.bulkDelete(eventIds)
      if (localRow) await db.customerPrices.delete(localRow.id)
    }
  }

  // 5-6. Mọi dòng outbox/cục bộ còn trỏ tới D (gid hoặc id cục bộ) thì nối sang `existing`.
  const outboxAfterPrices = (await db.outbox.toArray()) as OutboxRow[]
  for (const row of outboxAfterPrices) {
    let changed = false
    const refs = { ...row.refs }
    if (refs.itemId === dGid) {
      refs.itemId = existing.gid
      changed = true
    }
    let before = row.before
    let after = row.after
    if (dLocalId !== null) {
      if (before && (before as { itemId?: unknown }).itemId === dLocalId) {
        before = { ...before, itemId: existing.id }
        changed = true
      }
      if (after && (after as { itemId?: unknown }).itemId === dLocalId) {
        after = { ...after, itemId: existing.id }
        changed = true
      }
    }
    if (changed && row.id !== undefined) {
      await db.outbox.update(row.id, { refs, before, after })
    }
  }

  if (dLocalId !== null) {
    await db.orderLines.where('itemId').equals(dLocalId).modify({ itemId: existing.id })
    const remainingLocalPrices = (await db.customerPrices
      .where('itemId')
      .equals(dLocalId)
      .toArray()) as CustomerPriceRow[]
    for (const row of remainingLocalPrices) {
      await db.customerPrices.update(row.id, { itemId: existing.id })
    }
    // 7. D còn trên máy thì xoá — không có context chụp (ngoài outbox hooks) nên không sinh sự kiện mới.
    const dStill = (await db.items.where('gid').equals(dGid).first()) as ItemRow | undefined
    if (dStill) await db.items.delete(dStill.id)
  }

  const parts = [
    `Món “${tenLucTao}” trùng tên món “${existingName}” đang bán trong sổ chung (máy khác thêm trước).`,
    `Máy này đã nối sang món có sẵn; giá bán hiện tại của món là ${formatVnd(existing.unitPrice)}.`,
  ]
  if (droppedPrices > 0) {
    parts.push(`${droppedPrices} giá riêng của món trùng bị bỏ vì khách đã có giá riêng cho món có sẵn.`)
  }
  if (tenCuoi && tenCuoi !== tenLucTao) {
    parts.push(
      `Món này đã được đổi tên thành “${tenCuoi}” trên máy nhưng vẫn được gộp vào “${existingName}” vì lúc tạo nó trùng tên.`,
    )
  }
  await notice(parts.join(' '))
}

async function resolvePut(transaction: Transaction, rejected: OutboxRow, existingName: string): Promise<void> {
  const outboxNow = (await db.outbox.toArray()) as OutboxRow[]
  const dropped = outboxNow.filter(
    (row) =>
      row.table === 'items' &&
      row.entityKey === rejected.entityKey &&
      (row.id ?? 0) >= (rejected.id ?? 0),
  )
  const sortedNewestFirst = [...dropped].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))

  let conflict = false
  for (const row of sortedNewestFirst) {
    if (!(await restoreRow(transaction, row))) conflict = true
  }
  await db.outbox.bulkDelete(dropped.map((row) => row.id).filter((id): id is number => id !== undefined))
  await markResyncIfConflict(conflict)

  const banLai = rejected.before && (rejected.before as { isActive?: unknown }).isActive === 0 && rejected.after && (rejected.after as { isActive?: unknown }).isActive === 1
  const tenTruoc = String((rejected.before as { name?: unknown } | null)?.name ?? '')
  const otherDropped = dropped.length - 1

  const parts = [
    `Không ${banLai ? 'bán lại' : 'đổi tên'} được món “${tenTruoc}”: sổ chung đã có món “${existingName}” đang bán.`,
  ]
  if (otherDropped > 0) {
    parts.push(`${otherDropped} thay đổi khác của món này trên máy cũng được hoàn lại.`)
  }
  if (conflict) {
    parts.push('Món này vừa được sửa ở máy khác nên app sẽ kéo lại sổ chung.')
  }
  await notice(parts.join(' '))
}

export async function resolveItemNameTaken(
  rejected: OutboxRow,
  existingGid: string,
  existingName: string,
  leader: LeaderToken,
): Promise<'resolved' | 'deferred'> {
  const tables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  return db.transaction('rw', [...tables, db.outbox, db.deviceState], async (transaction) => {
    await assertLeadership(db, leader)
    verbatimWrites.add(transaction)

    const existing = (await db.items.where('gid').equals(existingGid).first()) as ItemRow | undefined
    if (!existing) return 'deferred'

    if (rejected.operation === 'create') {
      await resolveCreate(rejected, existing, existingName)
    } else {
      await resolvePut(transaction, rejected, existingName)
    }

    await assertLeadership(db, leader)
    return 'resolved'
  })
}
