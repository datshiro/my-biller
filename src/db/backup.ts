import { version as APP_VERSION } from '../../package.json'
import { db } from './db'
import { recalcAll } from './recalc'
import { BACKUP_VERSION, cleanPriceRows } from '@/domain/backup'
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

async function assertOfflineLedgerWriteAllowed(action: 'xoá' | 'nhập'): Promise<void> {
  const [connection, pairing, writeBlock] = await Promise.all([
    db.deviceState.get('connection'),
    db.deviceState.get('pairing'),
    db.deviceState.get('writeBlock'),
  ])
  if (!connection && !pairing && !writeBlock) return

  const verb = action === 'xoá' ? 'xoá sổ cục bộ' : 'nhập file sao lưu'
  throw new Error(
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

export async function countAllRecords(): Promise<number> {
  const counts = await Promise.all(ledgerTables().map((table) => table.count()))
  return counts.reduce((total, count) => total + count, 0)
}
