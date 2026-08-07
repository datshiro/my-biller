import { version as APP_VERSION } from '../../package.json'
import { db } from './db'
import { BackupFileSchema, type BackupData, type BackupFile } from '@/domain/schema'

/**
 * Ảnh chụp toàn bộ DB, đọc trong **một** transaction: bấm "Sao lưu" đúng lúc một đơn đang được ghi
 * mà đọc từng bảng rời rạc thì ra file có đơn nhưng thiếu dòng đơn — mất tiền mà không ai thấy.
 */
export function collectBackup(exportedAt: number): Promise<BackupFile> {
  return db.transaction('r', db.tables, async () => {
    const [settings, itemGroups, items, customers, orders, orderLines, payments, expenseCategories, expenses] =
      await Promise.all([
        db.settings.toArray(),
        db.itemGroups.toArray(),
        db.items.toArray(),
        db.customers.toArray(),
        db.orders.toArray(),
        db.orderLines.toArray(),
        db.payments.toArray(),
        db.expenseCategories.toArray(),
        db.expenses.toArray(),
      ])

    return BackupFileSchema.parse({
      app: 'my-biller',
      version: 1,
      appVersion: APP_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
      data: { settings, itemGroups, items, customers, orders, orderLines, payments, expenseCategories, expenses },
    })
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
  await db.transaction('rw', db.tables, async () => {
    await clearEveryTable()
    await Promise.all([
      db.settings.bulkPut(data.settings),
      db.itemGroups.bulkPut(data.itemGroups),
      db.items.bulkPut(data.items),
      db.customers.bulkPut(data.customers),
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
