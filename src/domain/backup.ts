import { format } from 'date-fns'
import { formatVnd } from './money'
import { BackupFileSchema, type BackupData, type BackupFile } from './schema'

export const BACKUP_VERSION = 1

const idsOf = (rows: readonly { id: number }[]) => new Set(rows.map((row) => row.id))

/** Dòng đầu tiên trỏ tới một `id` không có trong file. `null` ở khoá ngoại là hợp lệ (không gắn ai). */
function orphan<T>(rows: readonly T[], parents: Set<number>, link: (row: T) => number | null): T | undefined {
  return rows.find((row) => {
    const parentId = link(row)
    return parentId !== null && !parents.has(parentId)
  })
}

function duplicateId(rows: readonly { id: number }[]): number | undefined {
  const seen = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.id)) return row.id
    seen.add(row.id)
  }
  return undefined
}

/**
 * Kiểm những thứ schema không thấy được: id trùng nhau và khoá ngoại trỏ vào chỗ trống. Schema chỉ
 * soi từng bản ghi một, còn hỏng ở đây là hỏng **giữa** các bảng — và `replaceAllData` nạp bằng
 * `bulkPut` nên nó nhận tuốt, chỉ tới lúc mở màn hình mới thấy đơn không có hàng.
 *
 * Trả về lời mô tả chỗ hỏng (đã là câu người bán đọc được), `null` nghĩa là file lành.
 */
export function validateBackupIntegrity(data: BackupData): string | null {
  for (const [table, rows] of Object.entries(data)) {
    if (table === 'settings') continue
    const duplicate = duplicateId(rows as readonly { id: number }[])
    if (duplicate !== undefined) return `bảng "${table}" có hai dòng cùng mang số ${duplicate}`
  }

  const orders = idsOf(data.orders)
  const customers = idsOf(data.customers)

  const line = orphan(data.orderLines, orders, (row) => row.orderId)
  if (line) return `dòng hàng “${line.name}” thuộc về đơn số ${line.orderId} mà file không có đơn đó`

  const payment = orphan(data.payments, orders, (row) => row.orderId)
  if (payment) return `có phiếu thu ${formatVnd(payment.amount)} của đơn số ${payment.orderId} mà file không có đơn đó`

  const order = orphan(data.orders, customers, (row) => row.customerId)
  if (order) return `đơn ${order.code} ghi cho khách số ${order.customerId} mà file không có khách đó`

  const owed = orphan(data.payments, customers, (row) => row.customerId)
  if (owed) return `có phiếu thu ghi cho khách số ${owed.customerId} mà file không có khách đó`

  const item = orphan(data.items, idsOf(data.itemGroups), (row) => row.groupId)
  if (item) return `mặt hàng “${item.name}” thuộc nhóm số ${item.groupId} mà file không có nhóm đó`

  const expense = orphan(data.expenses, idsOf(data.expenseCategories), (row) => row.categoryId)
  if (expense) return `có khoản chi ${formatVnd(expense.amount)} thuộc loại số ${expense.categoryId} mà file không có loại đó`

  return ownerlessDebt(data)
}

/**
 * Nợ không có chủ là nợ tàng hình: màn Công nợ gom theo khách nên đơn `customerId = null` mà còn
 * thiếu tiền sẽ không hiện ở đâu cả, trong khi doanh thu vẫn cộng đủ. `createOrder` đã chặn đường
 * này, nhưng file sao lưu đi thẳng vào `bulkPut` nên phải chặn lại ở đây.
 *
 * Tính số đã thu từ chính bảng `payments` chứ không tin `paidAmount` trong file — sau khi nhập,
 * `recalcAll()` cũng dựng lại đúng như vậy.
 */
function ownerlessDebt(data: BackupData): string | null {
  const paid = new Map<number, number>()
  for (const payment of data.payments) {
    paid.set(payment.orderId, (paid.get(payment.orderId) ?? 0) + payment.amount)
  }

  const order = data.orders.find(
    (row) => row.status !== 'void' && row.customerId === null && row.total > (paid.get(row.id) ?? 0),
  )
  if (!order) return null

  const owing = order.total - (paid.get(order.id) ?? 0)
  return `đơn ${order.code} còn thiếu ${formatVnd(owing)} nhưng không ghi khách nào — nhập vào thì khoản nợ đó biến mất khỏi mọi màn hình`
}

export function backupFilename(at: number): string {
  return `my-biller-backup-${format(at, 'yyMMdd-HHmm')}.json`
}

/**
 * Đọc file sao lưu và **chặn mọi thứ không đúng định dạng trước khi ai đó chạm vào DB**. Lỗi trả về
 * phải nói được người bán làm gì tiếp, vì đây là lúc họ đang lo mất dữ liệu chứ không phải lúc đọc
 * thông báo kỹ thuật.
 */
export function parseBackupFile(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('File này không phải file sao lưu (không đọc được nội dung JSON).')
  }

  const parsed = BackupFileSchema.safeParse(raw)
  if (parsed.success) {
    const broken = validateBackupIntegrity(parsed.data.data)
    if (broken) throw new Error(`File sao lưu bị hỏng: ${broken}. Không nhập được.`)
    return parsed.data
  }

  const app = (raw as { app?: unknown } | null)?.app
  if (app !== undefined && app !== 'my-biller') {
    throw new Error('File sao lưu của ứng dụng khác, không nhập vào đây được.')
  }

  const version = (raw as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > BACKUP_VERSION) {
    throw new Error(
      `File được tạo bởi bản mới hơn (v${version}). Cập nhật app rồi nhập lại, đừng nhập bằng bản cũ.`,
    )
  }

  const first = parsed.error.issues[0]
  const where = first?.path.join('.')
  throw new Error(`File sao lưu bị hỏng${where ? ` ở phần "${where}"` : ''} — không nhập được.`)
}

export type BackupCounts = {
  orders: number
  items: number
  customers: number
  expenses: number
}

export function countRecords(data: BackupData): BackupCounts {
  return {
    orders: data.orders.length,
    items: data.items.length,
    customers: data.customers.length,
    expenses: data.expenses.length,
  }
}

export function describeCounts(counts: BackupCounts): string {
  return `${counts.orders} đơn · ${counts.items} mặt hàng · ${counts.customers} khách · ${counts.expenses} khoản chi`
}
