import { collectBackup, replaceAllData, wipeAllData } from '@/db/backup'
import { recalcAll } from '@/db/recalc'
import { saveLastBackupAt } from '@/db/repositories/settings'
import {
  backupFilename,
  countOperationalRecords,
  parseBackupFile,
  type BackupCounts,
} from '@/domain/backup'
import type { BackupData, BackupFile } from '@/domain/schema'

function downloadJson(filename: string, file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Thu hồi ngay lập tức thì Safari huỷ luôn cú tải vừa bắt đầu — nhả sang nhịp sau.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type PreparedBackup = {
  at: number
  filename: string
  /** Một representation duy nhất cho cả cú tải và Web Share. */
  file: File
  counts: BackupCounts
  importable: boolean
  problem: string | null
}

/**
 * Kết quả một lần sao lưu. File **luôn** ra khỏi máy, nhưng "đã sao lưu" thì không phải lúc nào
 * cũng đúng — `importable` là thứ phân biệt hai chuyện đó.
 */
export type BackupOutcome = {
  filename: string
  /** File này nhập lại được. Chỉ khi đó mới có nghĩa là người bán thật sự có đường về. */
  importable: boolean
  /** Chỗ hỏng khiến file không nhập lại được, để màn hình chỉ đúng chỗ cần sửa tay. */
  problem: string | null
}

export type BackupShareOutcome = 'shared' | 'cancelled' | 'failed'

/** Gom và kiểm đúng một snapshot; chưa tạo Blob URL, chưa tải file và chưa đóng dấu sao lưu. */
export async function prepareBackup(at: number): Promise<PreparedBackup> {
  const collected = await collectBackup(at)
  // Xuống dòng, thụt lề: file sao lưu phải đọc và sửa tay được, đây là lối thoát cuối cùng khi hỏng.
  const text = JSON.stringify(collected, null, 2)
  const filename = backupFilename(at)
  const file = new File([text], filename, { type: 'application/json' })

  let problem: string | null = null
  try {
    parseBackupFile(text)
  } catch (caught) {
    problem = caught instanceof Error ? caught.message : 'Không rõ vì sao.'
  }

  return {
    at,
    filename,
    file,
    counts: countOperationalRecords(collected.data),
    importable: problem === null,
    problem,
  }
}

/** Phát đúng prepared `File`; file lành mới được atomically ghi mốc sao lưu không lùi. */
export async function downloadPreparedBackup(prepared: PreparedBackup): Promise<BackupOutcome> {
  downloadJson(prepared.filename, prepared.file)
  if (prepared.importable) await saveLastBackupAt(prepared.at)
  return {
    filename: prepared.filename,
    importable: prepared.importable,
    problem: prepared.problem,
  }
}

/** Chỉ hiện CTA khi trình duyệt chấp nhận chính file JSON sẽ gửi. Probe lỗi = không hỗ trợ. */
export function canSharePreparedBackup(prepared: PreparedBackup): boolean {
  try {
    if (!prepared.importable || typeof navigator.share !== 'function') return false
    return navigator.canShare?.({ files: [prepared.file] }) === true
  } catch {
    return false
  }
}

export async function sharePreparedBackup(prepared: PreparedBackup): Promise<BackupShareOutcome> {
  try {
    await navigator.share({ files: [prepared.file] })
    return 'shared'
  } catch (caught) {
    if (typeof caught === 'object' && caught !== null && 'name' in caught && caught.name === 'AbortError') {
      return 'cancelled'
    }
    return 'failed'
  }
}

/**
 * Xuất file sao lưu. Cũng là bản sao an toàn đứng ngay trước hai bước không quay lại được: ghi đè
 * khi nhập file, và xoá sạch.
 *
 * File vẫn tải về kể cả khi có bản ghi lạ (bản build cũ, sửa tay qua DevTools) — đó là dữ liệu của
 * người bán, và `parseBackupFile` lúc nhập lại sẽ chỉ đúng dòng cần sửa. Nhưng **mốc sao lưu thì
 * không**: `lastBackupAt` là thứ tắt banner nhắc sao lưu, nên đóng dấu nó cho một file mà
 * `parseBackupFile` sẽ từ chối là hứa với người bán một đường về không tồn tại — và họ chỉ phát
 * hiện ra đúng vào lúc cần phục hồi.
 *
 * `collectBackup` cố ý khoan dung với bản ghi lạ còn `parseBackupFile` thì nghiêm ngặt, nên tồn tại
 * đúng một loại file vừa xuất được vừa không nhập lại được. Hàm này **không** tự chặn loại file đó:
 * chặn ở đây thì người bán mắc kẹt — không nhập được file mới mà cũng không xoá được để bắt đầu lại,
 * ngay trong app, không lối nào ra. Thay vào đó nó nói thật qua `importable`/`problem`, và màn hình
 * dựng thêm một cửa xác nhận cho đúng trường hợp đó (xem `danger-zone.tsx`, `settings-page.tsx`).
 */
export async function exportBackup(at: number): Promise<BackupOutcome> {
  return downloadPreparedBackup(await prepareBackup(at))
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
