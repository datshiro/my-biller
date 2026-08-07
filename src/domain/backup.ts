import { format } from 'date-fns'
import { BackupFileSchema, type BackupData, type BackupFile } from './schema'

export const BACKUP_VERSION = 1

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
  if (parsed.success) return parsed.data

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
