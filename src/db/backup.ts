import { version as APP_VERSION } from '../../package.json'
import { db } from './db'
import { recalcAll } from './recalc'
import { BACKUP_VERSION, cleanPriceRows } from '@/domain/backup'
import {
  findPaymentConflicts,
  MergeReviewError,
  mergeByGid,
  type MergeSummary,
  type PaymentChoice,
} from '@/domain/backup-merge'
import { withDerivedPaid, type DerivedLedger } from '@/domain/backup-report'
import { BackupFileSchema, type BackupData, type BackupFile } from '@/domain/schema'

/** Các bảng thuộc cuốn sổ. Trạng thái riêng của máy tuyệt đối không đi theo sao lưu/phục hồi. */
const ledgerTables = () => [
  db.settings,
  db.itemGroups,
  db.items,
  db.customers,
  db.customerPrices,
  db.orders,
  db.orderLines,
  db.payments,
  db.expenseCategories,
  db.expenses,
]

/**
 * Ảnh chụp toàn bộ DB, đọc trong **một** transaction: bấm "Sao lưu" đúng lúc một đơn đang được ghi
 * mà đọc từng bảng rời rạc thì ra file có đơn nhưng thiếu dòng đơn — mất tiền mà không ai thấy.
 */
export function collectBackup(exportedAt: number): Promise<BackupFile> {
  return db.transaction('r', ledgerTables(), async () => {
    const [
      settings,
      itemGroups,
      items,
      customers,
      customerPrices,
      orders,
      orderLines,
      payments,
      expenseCategories,
      expenses,
    ] = await Promise.all([
      db.settings.toArray(),
      db.itemGroups.toArray(),
      db.items.toArray(),
      db.customers.toArray(),
      db.customerPrices.toArray(),
      db.orders.toArray(),
      db.orderLines.toArray(),
      db.payments.toArray(),
      db.expenseCategories.toArray(),
      db.expenses.toArray(),
    ])

    // `satisfies` là hàng rào duy nhất ở đây: `file as BackupFile` bên dưới cố ý khoan dung, nên quên
    // một bảng trong danh sách này thì `tsc` im lặng và mọi file xuất ra rỗng hẳn bảng đó — không màn
    // hình nào kêu, chỉ tới lúc phục hồi mới biết là mất.
    const data = {
      settings,
      itemGroups,
      items,
      customers,
      customerPrices,
      orders,
      orderLines,
      payments,
      expenseCategories,
      expenses,
    } satisfies Record<keyof BackupData, unknown[]>

    const file = {
      app: 'my-biller' as const,
      version: BACKUP_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
      data,
    }

    // Cho schema soi nhưng **không** cho nó chặn. Một bản ghi lạ (bản build cũ, sửa tay qua DevTools)
    // mà làm ném ở đây là khoá luôn cả đường tự cứu: `applyBackup` xuất file an toàn trước khi nhập,
    // nên sao lưu chết kéo theo nhập file cũng chết. Thà ra file có một dòng lạ — dòng đó vẫn là
    // dữ liệu của người bán, và lúc nhập lại thì `parseBackupFile` chỉ đúng chỗ cần sửa tay.
    const checked = BackupFileSchema.safeParse(file)
    return checked.success ? checked.data : (file as BackupFile)
  })
}

const clearLedger = () => Promise.all(ledgerTables().map((table) => table.clear()))

export type RestoreBlock = 'connected' | 'pairing' | 'revoked'

/** Chốt chặn ghi đè sổ cục bộ; `reason` để màn dịch sang lời giải thích, `message` giữ câu cũ. */
export class RestoreBlockedError extends Error {
  override name = 'RestoreBlockedError'
  readonly reason: RestoreBlock

  constructor(reason: RestoreBlock, message: string) {
    super(message)
    this.reason = reason
  }
}

/**
 * Vì sao máy này không được ghi đè/gộp sổ cục bộ — một nguồn sự thật cho màn hình (`useLiveQuery`) và cho
 * chốt chặn trong khoá ghi. Chỉ đọc Dexie nên gọi lồng trong transaction được.
 *
 * Đang ghép đứng trước: ghép lại một máy đã bị thu hồi thì `writeBlock` còn tới khi ghép xong, và lúc lưu
 * kết nối thì `connection` có trước khi khoá `pairing` được gỡ — trong cả hai cảnh, việc đang diễn ra là ghép.
 */
export async function getRestoreBlock(): Promise<RestoreBlock | null> {
  const [connection, pairing, writeBlock] = await Promise.all([
    db.deviceState.get('connection'),
    db.deviceState.get('pairing'),
    db.deviceState.get('writeBlock'),
  ])
  if (pairing) return 'pairing'
  if (writeBlock) return 'revoked'
  if (connection) return 'connected'
  return null
}

async function assertOfflineLedgerWriteAllowed(action: 'xoá' | 'nhập'): Promise<void> {
  const reason = await getRestoreBlock()
  if (!reason) return

  const verb = action === 'xoá' ? 'xoá sổ cục bộ' : 'nhập file sao lưu'
  throw new RestoreBlockedError(
    reason,
    `Máy đã ghép, đang ghép hoặc đã bị thu hồi không thể ${verb} từ đây. Hãy dùng “Kéo lại từ đầu” hoặc ghép lại.`,
  )
}

async function offlineLedgerTransaction<T>(
  action: 'xoá' | 'nhập',
  callback: () => Promise<T>,
): Promise<T> {
  return db.transaction(
    'rw',
    [...ledgerTables(), db.deviceState, db.outbox],
    async () => {
      // Kiểm ngay trong transaction giữ cả ledger, deviceState và outbox. Một tab không thể đọc
      // "chưa ghép", xếp hàng sau transaction ghép máy, rồi ghi đè ảnh sổ vừa được stage.
      await assertOfflineLedgerWriteAllowed(action)
      return callback()
    },
  )
}

async function replaceLedger(data: BackupData): Promise<void> {
  const { rows: customerPrices } = cleanPriceRows(data)
  await clearLedger()
  await Promise.all([
    db.settings.bulkPut(data.settings),
    db.itemGroups.bulkPut(data.itemGroups),
    db.items.bulkPut(data.items),
    db.customers.bulkPut(data.customers),
    db.customerPrices.bulkPut(customerPrices),
    db.orders.bulkPut(data.orders),
    db.orderLines.bulkPut(data.orderLines),
    db.payments.bulkPut(data.payments),
    db.expenseCategories.bulkPut(data.expenseCategories),
    db.expenses.bulkPut(data.expenses),
  ])
}

export async function wipeAllData(): Promise<void> {
  await offlineLedgerTransaction('xoá', async () => {
    await clearLedger()
  })
}

/**
 * Xoá sạch rồi nạp lại, trong một transaction — file hỏng giữa chừng thì IndexedDB rollback về
 * nguyên trạng, không để lại nửa bộ dữ liệu.
 *
 * `bulkPut` giữ nguyên `id` trong file: `orderLines.orderId` và `payments.orderId` trỏ theo id, đánh
 * số lại là cắt đứt đơn khỏi dòng hàng của nó.
 */
export async function replaceAllData(data: BackupData): Promise<void> {
  // Dòng giá riêng mồ côi / trùng cặp bị bỏ ở đây thay vì chặn cả file — lý do ở `cleanPriceRows`.
  // Số dòng bị bỏ đã hiện ở cửa xác nhận trước khi tới đây (`describeDroppedPrices`).
  await offlineLedgerTransaction('nhập', async () => {
    await replaceLedger(data)
  })
}

/** Nhập file và dựng lại số tiền trong cùng khóa offline, không mở khe cho tab khác ghép ở giữa. */
export async function replaceAllDataAndRecalculate(data: BackupData): Promise<number> {
  return offlineLedgerTransaction('nhập', async () => {
    await replaceLedger(data)
    return recalcAll()
  })
}

/**
 * Gộp file vào sổ máy theo gid, trong cùng khoá nhập với Ghi đè. Sổ được đọc lại và gộp lại **trong khoá**
 * — không dùng kết quả xem trước — rồi `replaceLedger` + `recalcAll`.
 *
 * `answeredFingerprints` là dấu vân tay của các xung đột khoản thu người bán đã trả lời ở xem trước. Tập
 * tính lại trong khoá khác tập đó (thêm/bớt xung đột, hoặc cùng gid mà nội dung đổi) ⇒ ném, không ghi gì.
 *
 * Trong callback chỉ được chờ promise của Dexie: chờ một promise khác (vd `crypto.subtle`) là Dexie tự
 * commit transaction giữa chừng và phần ghi sau rơi ra ngoài khoá. Vì vậy dấu vân tay là chuỗi so đồng bộ.
 *
 * `expected` tính thuần từ sổ gộp, không đọc lại DB — so với `getLedgerOverview()` gọi sau khi khoá đóng.
 */
export async function mergeAllDataAndRecalculate(
  incoming: BackupData,
  paymentChoices: Readonly<Record<string, PaymentChoice>>,
  answeredFingerprints: readonly string[],
): Promise<{ expected: DerivedLedger; summary: MergeSummary }> {
  return offlineLedgerTransaction('nhập', async () => {
    const current = (await collectBackup(Date.now())).data
    const identity = await db.deviceState.get('identity')

    const now = findPaymentConflicts(current, incoming).map((conflict) => conflict.fingerprint).sort()
    const answered = [...answeredFingerprints].sort()
    if (now.length !== answered.length || now.some((fingerprint, index) => fingerprint !== answered[index])) {
      throw new MergeReviewError('Sổ vừa thay đổi, mở lại xem trước rồi chọn lại.')
    }

    const outcome = mergeByGid(
      current,
      incoming,
      paymentChoices,
      identity?.key === 'identity' ? identity.letter : 'B',
    )
    if (outcome.blocked !== null) {
      throw new MergeReviewError(`Sổ trên máy đang có chỗ hỏng: ${outcome.blocked} — lần này chỉ Ghi đè được.`)
    }

    await replaceLedger(outcome.merged)
    await recalcAll()
    return { expected: withDerivedPaid(outcome.merged), summary: outcome.summary }
  })
}

export async function countAllRecords(): Promise<number> {
  const counts = await Promise.all(ledgerTables().map((table) => table.count()))
  return counts.reduce((total, count) => total + count, 0)
}
