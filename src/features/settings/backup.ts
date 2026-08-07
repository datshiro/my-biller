import { collectBackup, replaceAllData, wipeAllData } from '@/db/backup'
import { recalcAll } from '@/db/recalc'
import { saveAppState } from '@/db/repositories/settings'
import { backupFilename, parseBackupFile } from '@/domain/backup'
import type { BackupData, BackupFile } from '@/domain/schema'

function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Thu hồi ngay lập tức thì Safari huỷ luôn cú tải vừa bắt đầu — nhả sang nhịp sau.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Xuất file và ghi mốc sao lưu. Trả tên file để màn hình nói rõ vừa tạo ra cái gì. */
export async function exportBackup(at: number): Promise<string> {
  const file = await collectBackup(at)
  const filename = backupFilename(at)
  // Xuống dòng, thụt lề: file sao lưu phải đọc và sửa tay được, đây là lối thoát cuối cùng khi hỏng.
  downloadJson(filename, JSON.stringify(file, null, 2))
  await saveAppState({ lastBackupAt: at })
  return filename
}

/** Chỉ đọc và kiểm file — **không** chạm vào DB. Sai định dạng thì ném lỗi ở đây, trước mọi thứ khác. */
export async function readBackupFile(file: File): Promise<BackupFile> {
  return parseBackupFile(await file.text())
}

/**
 * Ghi đè toàn bộ dữ liệu. Chỉ gọi sau khi `readBackupFile` đã qua và người bán đã xác nhận.
 *
 * Tự xuất bản hiện tại ra file **trước** khi xoá: nếu người bán chọn nhầm file cũ, thứ vừa mất vẫn
 * còn nằm trong Downloads. `recalcAll()` chạy sau cùng để `paidAmount`/`status` được dựng lại từ
 * `payments` thay vì tin vào con số đã lưu trong file.
 */
export async function applyBackup(data: BackupData, at: number): Promise<void> {
  await exportBackup(at)
  await replaceAllData(data)
  await recalcAll()
}

/** Xoá sạch, cũng xuất file trước — đổi ý sau khi bấm thì vẫn nhập lại được. */
export async function wipeAfterBackup(at: number): Promise<void> {
  await exportBackup(at)
  await wipeAllData()
}
