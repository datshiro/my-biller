import { version as APP_VERSION } from '../../package.json'
import { db } from './db'
import { BACKUP_VERSION, cleanPriceRows } from '@/domain/backup'
import { BackupFileSchema, type BackupData, type BackupFile } from '@/domain/schema'

/**
 * Ảnh chụp toàn bộ DB, đọc trong **một** transaction: bấm "Sao lưu" đúng lúc một đơn đang được ghi
 * mà đọc từng bảng rời rạc thì ra file có đơn nhưng thiếu dòng đơn — mất tiền mà không ai thấy.
 */
export function collectBackup(exportedAt: number): Promise<BackupFile> {
  return db.transaction('r', db.tables, async () => {
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

const clearEveryTable = () => Promise.all(db.tables.map((table) => table.clear()))

export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, clearEveryTable)
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
  const { rows: customerPrices } = cleanPriceRows(data)

  await db.transaction('rw', db.tables, async () => {
    await clearEveryTable()
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
  })
}

export async function countAllRecords(): Promise<number> {
  const counts = await Promise.all(db.tables.map((table) => table.count()))
  return counts.reduce((total, count) => total + count, 0)
}
