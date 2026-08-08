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

// Xuống dòng, thụt lề: file sao lưu phải đọc và sửa tay được, đây là lối thoát cuối cùng khi hỏng.
const backupText = async (at: number) => JSON.stringify(await collectBackup(at), null, 2)

async function writeBackup(at: number, text: string): Promise<string> {
  const filename = backupFilename(at)
  downloadJson(filename, text)
  await saveAppState({ lastBackupAt: at })
  return filename
}

/** Xuất file và ghi mốc sao lưu. Trả tên file để màn hình nói rõ vừa tạo ra cái gì. */
export async function exportBackup(at: number): Promise<string> {
  return writeBackup(at, await backupText(at))
}

/**
 * Bản sao an toàn cho hai bước không quay lại được: ghi đè khi nhập file, và xoá sạch.
 *
 * Khác `exportBackup` ở chỗ nó **đọc lại** đúng nội dung vừa ghi ra. `collectBackup` cố ý khoan dung
 * để một bản ghi lạ không làm chết cả lần sao lưu, nhưng `parseBackupFile` thì nghiêm ngặt — nên có
 * đúng một loại file vừa xuất được vừa không nhập lại được. Đưa file đó ra rồi xoá sạch là dựng một
 * cái bẫy: người bán thấy file trong máy, tin là còn đường về, mà không còn.
 *
 * Hỏng thì ném lỗi nêu đúng bản ghi hỏng và **không tải gì cả** — thà chặn còn hơn xoá.
 */
export async function exportSafetyCopy(at: number): Promise<string> {
  const text = await backupText(at)
  parseBackupFile(text)
  return writeBackup(at, text)
}

/** Chỉ đọc và kiểm file — **không** chạm vào DB. Sai định dạng thì ném lỗi ở đây, trước mọi thứ khác. */
export async function readBackupFile(file: File): Promise<BackupFile> {
  return parseBackupFile(await file.text())
}

/**
 * Ghi đè toàn bộ dữ liệu. Chỉ gọi sau khi `readBackupFile` đã qua, người bán đã xác nhận, **và**
 * bản hiện tại đã được xuất ra file an toàn mà người bán tự mắt thấy trong máy.
 *
 * Việc xuất file an toàn cố ý **không** nằm trong hàm này: `exportBackup` chỉ gọi `link.click()`
 * rồi trả về, không có gì bảo đảm trình duyệt đã ghi được file — webview Zalo và PWA trên iOS có
 * thể nuốt mất cú tải trong im lặng. Bước không quay lại được thì phải để mắt người thật xác nhận,
 * nên chốt chặn đó nằm ở giao diện, ngay trước lời gọi này.
 *
 * `recalcAll()` chạy sau cùng để `paidAmount`/`status` được dựng lại từ `payments` thay vì tin vào
 * con số đã lưu trong file.
 */
export async function applyBackup(data: BackupData): Promise<void> {
  await replaceAllData(data)
  await recalcAll()
}

/** Xoá sạch. Cũng chỉ gọi sau khi người bán xác nhận đã thấy file an toàn — xem `applyBackup`. */
export async function wipeEverything(): Promise<void> {
  await wipeAllData()
}
