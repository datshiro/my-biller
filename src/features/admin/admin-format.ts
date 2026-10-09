import { format } from 'date-fns'
import { SyncApiError } from '@/db/sync/client'

export const LAG_NOTE = 'Số này là lần báo gần nhất của máy, chậm tối đa 60 giây'

export function formatAt(timestamp: number | null): string {
  return timestamp === null ? '—' : format(timestamp, 'dd/MM/yyyy HH:mm')
}

export function errorText(caught: unknown): string {
  if (caught instanceof SyncApiError) {
    if (caught.code === 'unauthorized') return 'Sai mật khẩu'
    if (caught.code === 'rate-limited') return 'Thử lại sau một phút'
    if (caught.code === 'admin-unavailable') return 'Khu admin đang khoá hoặc máy chủ lỗi. Thử lại sau.'
  }
  return caught instanceof Error ? caught.message : 'Không đọc được dữ liệu. Thử lại.'
}

/** `after` của một dòng sổ là dữ liệu do máy gửi lên: đọc từng trường theo kiểu, không tin hình dạng. */
export function textField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

export function numberField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}
