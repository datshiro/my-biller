import {
  collectBackup,
  mergeAllDataAndRecalculate,
  replaceAllDataAndRecalculate,
  wipeAllData,
} from '@/db/backup'
import { saveLastBackupAt } from '@/db/repositories/settings'
import {
  backupFilename,
  countOperationalRecords,
  countRecords,
  parseBackupFile,
  type BackupCounts,
} from '@/domain/backup'
import type { BackupData, BackupFile } from '@/domain/schema'
import { getDeviceConnection } from '@/db/repositories/device-state'
import { getLedgerOverview } from '@/db/doi-soat-snapshot'
import {
  buildRestoreReport,
  expectedAfterReplace,
  toReportActual,
  type DerivedLedger,
  type RestoreReport,
} from '@/domain/backup-report'
import { saveToDownloads, type SavedFile } from './download-sink'
import type { MergeSummary, PaymentChoice } from '@/domain/backup-merge'

export type PreparedBackup = {
  at: number
  filename: string
  /** Đúng nội dung của `file`: cửa ra file nhận chữ, Web Share nhận `File`. */
  text: string
  /** Bản `File` cho Web Share, cùng nội dung với `text`. */
  file: File
  counts: BackupCounts
  importable: boolean
  problem: string | null
}

/**
 * Kết quả một lần sao lưu. File **luôn** ra khỏi máy, nhưng "đã sao lưu" thì không phải lúc nào
 * cũng đúng — `importable` là thứ phân biệt hai chuyện đó.
 */
export type BackupOutcome = SavedFile & {
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
    text,
    file,
    counts: countOperationalRecords(collected.data),
    importable: problem === null,
    problem,
  }
}

/** Ghi đúng nội dung của prepared `File` ra thư mục Tải về qua cửa ra file chung. */
async function savePrepared(prepared: PreparedBackup): Promise<BackupOutcome> {
  const saved = await saveToDownloads({
    filename: prepared.filename,
    mimeType: 'application/json',
    text: prepared.text,
  })
  return { ...saved, importable: prepared.importable, problem: prepared.problem }
}

/**
 * Lưu file rồi mới đóng dấu mốc sao lưu, và chỉ cho file nhập lại được. Trong APK plugin báo lỗi thì
 * `saveToDownloads` ném trước khi tới đây — mốc không bị đóng dấu cho một file không có trên máy (lỗi cũ:
 * WebView nuốt `<a download>` mà banner nhắc vẫn tắt). Trên web trình duyệt không báo lại được, nên vẫn đóng
 * dấu ngay sau khi yêu cầu tải: Chrome Android tải blob cùng nguồn bằng đường tải chuẩn của nó.
 */
export async function downloadPreparedBackup(prepared: PreparedBackup): Promise<BackupOutcome> {
  const outcome = await savePrepared(prepared)
  if (prepared.importable) await saveLastBackupAt(prepared.at)
  return outcome
}

/**
 * Recovery chỉ đọc không được ghi `lastBackupAt`: settings là ledger table, nên đóng dấu thành công
 * sẽ tạo outbox trên máy đã ghép. Artifact sự cố chỉ phát file và giữ nguyên toàn bộ state cục bộ.
 */
export function downloadRecoveryBackup(prepared: PreparedBackup): Promise<BackupOutcome> {
  return savePrepared(prepared)
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
export async function applyBackup(data: BackupData): Promise<RestoreReport | null> {
  // Không kiểm "đã ghép" ở đây: chốt chặn nằm trong khoá ghi và ném `RestoreBlockedError` có lý do, để màn
  // dịch sang lời giải thích. Kiểm trước khoá vừa thừa vừa che mất lý do đó.
  await replaceAllDataAndRecalculate(data)
  // Đọc sau khi khoá đóng; kỳ vọng tính thuần từ file, không đọc lại DB.
  return reportAfterWrite(expectedAfterReplace(data))
}

/** Số bản ghi đang có trên máy — cho xem trước Ghi đè ("Đang có trên máy: …"). */
export async function currentCounts(at: number): Promise<BackupCounts> {
  return countRecords((await collectBackup(at)).data)
}

/** Sổ trên máy lúc mở xem trước Gộp. Đọc một lần: xem trước tính trên đúng bản này, lựa chọn đổi không đọc lại. */
export async function readLedger(): Promise<BackupData> {
  return (await collectBackup(Date.now())).data
}

/**
 * File an toàn ngay trước Gộp. Gọi thẳng cửa ra file, **không** qua `downloadPreparedBackup`: hàm đó đóng
 * dấu `lastBackupAt`, tức là ghi vào sổ giữa lúc xem trước và lúc khoá gộp.
 */
export async function saveSafetyFile(): Promise<BackupOutcome> {
  const prepared = await prepareBackup(Date.now())
  const saved = await saveToDownloads({ filename: prepared.filename, mimeType: 'application/json', text: prepared.text })
  return { ...saved, importable: prepared.importable, problem: prepared.problem }
}

/**
 * Báo cáo đối chiếu sau khi ghi. Ghi đã xong thì lỗi ở đây chỉ làm mất báo cáo, không được ném ra: người
 * gọi phải coi lần ghi là xong, không đưa người bán về để ghi lần nữa.
 */
async function reportAfterWrite(expected: DerivedLedger): Promise<RestoreReport | null> {
  try {
    return buildRestoreReport(expected, toReportActual(await getLedgerOverview()))
  } catch {
    return null
  }
}

/**
 * Gộp file vào sổ máy: gộp lại trong khoá ghi (không dùng kết quả xem trước), rồi đối chiếu bản kỳ vọng
 * thuần với sổ đọc lại sau khi khoá đóng.
 */
export async function applyMerge(
  data: BackupData,
  paymentChoices: Readonly<Record<string, PaymentChoice>>,
  answeredFingerprints: readonly string[],
): Promise<{ report: RestoreReport | null; summary: MergeSummary }> {
  const { expected, summary } = await mergeAllDataAndRecalculate(data, paymentChoices, answeredFingerprints)
  return { report: await reportAfterWrite(expected), summary }
}

/** Xoá sạch. Cũng chỉ gọi sau khi người bán xác nhận đã thấy file an toàn — xem `applyBackup`. */
export async function wipeEverything(): Promise<void> {
  if (await getDeviceConnection()) {
    throw new Error('Máy đã ghép không xoá sổ chung từ đây. Hãy dùng “Kéo lại từ đầu”.')
  }
  await wipeAllData()
}
