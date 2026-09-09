import { db } from './db'
import { getDeviceSyncState } from './repositories/device-state'
import { countPendingOperations } from './sync/outbox'
import { ledgerTotals, type LedgerTotals } from '@/domain/doi-soat'
import { DeviceConnectionSchema, type DeviceConnection } from '@/domain/schema'
import { LEDGER_TABLE_NAMES, type LedgerTableName } from '@shared/sync-events'

export type CountedTable = Exclude<LedgerTableName, 'settings'>

/** Chín bảng sổ; `settings` là cấu hình máy, không phải dữ liệu để so hai máy. */
export const COUNTED_TABLES: readonly CountedTable[] = LEDGER_TABLE_NAMES.filter(
  (name): name is CountedTable => name !== 'settings',
)

export type SyncAnchor = {
  lastSeq: number
  /** Số transaction còn trong outbox — bốn tổng đang "lạc quan" khi số này lớn hơn 0. */
  pending: number
  resyncRequired: boolean
  connection: DeviceConnection | null
  pairingSaved: boolean
  revoked: boolean
}

/**
 * Neo đồng bộ — truy vấn rẻ, đúng chi phí `SyncBanner` đã trả trên mọi màn. Bốn khoá `deviceState`
 * và outbox đọc trong một transaction để không ghép `connection` của lúc A với `writeBlock` của lúc B.
 * Đọc bằng `get(<khoá>)`, không `toArray()`: khoá `lease` bị ghi lại mỗi 5 giây, `toArray` sẽ biến
 * liveQuery này thành vòng tính lại vô tận.
 */
export function getSyncAnchor(): Promise<SyncAnchor> {
  return db.transaction('r', db.deviceState, db.outbox, async () => {
    const [sync, connection, pairing, writeBlock, pending] = await Promise.all([
      getDeviceSyncState(),
      db.deviceState.get('connection'),
      db.deviceState.get('pairing'),
      db.deviceState.get('writeBlock'),
      countPendingOperations(),
    ])
    return {
      lastSeq: sync.lastSeq,
      pending,
      resyncRequired: sync.resyncRequired,
      connection:
        connection?.key === 'connection' ? DeviceConnectionSchema.parse(connection) : null,
      pairingSaved: pairing?.key === 'pairing' && pairing.connectionSaved,
      revoked: writeBlock?.key === 'writeBlock' && writeBlock.reason === 'revoked',
    }
  })
}

export type LedgerOverview = {
  totals: LedgerTotals
  counts: { table: CountedTable; count: number }[]
}

/**
 * Bốn tổng và số dòng — truy vấn nặng, cố ý tách khỏi neo. Transaction chỉ bao đúng 9 bảng sổ:
 * không `deviceState`, không `outbox`, nên pusher xoá từng event hay lease ghi mỗi 5 giây đều không
 * kích hoạt tính lại; chỉ trang applier mới làm. `ledgerTotals` chạy sau khi transaction đóng để
 * không giữ khoá 9 bảng trong lúc cộng.
 */
export async function getLedgerOverview(): Promise<LedgerOverview> {
  const tables = COUNTED_TABLES.map((name) => db.table(name))
  const raw = await db.transaction('r', tables, async () => {
    const [orders, payments, expenses, customers] = await Promise.all([
      db.orders.toArray(),
      db.payments.toArray(),
      db.expenses.toArray(),
      db.customers.toArray(),
    ])
    const counts = await Promise.all(
      COUNTED_TABLES.map(async (table) => ({ table, count: await db.table(table).count() })),
    )
    return { orders, payments, expenses, customers, counts }
  })
  return { totals: ledgerTotals(raw), counts: raw.counts }
}
