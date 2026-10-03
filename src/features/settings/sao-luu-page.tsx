import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyBackup,
  applyMerge,
  canSharePreparedBackup,
  currentCounts,
  downloadPreparedBackup,
  exportBackup,
  prepareBackup,
  readBackupFile,
  readLedger,
  saveSafetyFile,
  sharePreparedBackup,
  type BackupOutcome,
  type PreparedBackup,
} from './backup'
import { describeSavedFile, type SavedFile } from './download-sink'
import { MergePreviewSheet } from './merge-preview-sheet'
import { BackupBanner } from './backup-banner'
import { RESTORE_BLOCK_TEXT } from './restore-block-text'
import { RestoreReportCard } from './restore-report-card'
import { clearRestoreReport, readRestoreReport, saveRestoreReport } from './restore-report-store'
import { useDeviceIdentity, useLastBackupLine, useRestoreBlock } from './use-settings'
import { RestoreBlockedError } from '@/db/backup'
import {
  countRecords,
  describeCounts,
  type BackupCounts,
  describeDroppedPrices,
  isOperationallyEmpty,
} from '@/domain/backup'
import { findPaymentConflicts, isLegacyFile, MergeReviewError, type PaymentChoice } from '@/domain/backup-merge'
import type { BackupData, BackupFile } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ScreenHeader } from '@/ui/screen-header'
import { Sheet } from '@/ui/sheet'
import { requestFullResync } from '@/db/sync/applier'

const message = (error: unknown) => (error instanceof Error ? error.message : 'Không xong. Thử lại.')
const SHARE_TARGET_LIFETIME_MS = 10 * 60 * 1000
const SHARE_FAILURE_MESSAGE =
  'Không chia sẻ được file sao lưu. Hãy kiểm tra thư mục Tải về; bạn có thể thử lại hoặc gửi file từ đó.'

/**
 * Nhập file đi qua hai cửa. Cửa `safety` tồn tại vì bản xuất tự động trước khi ghi đè có thể thất
 * bại trong im lặng (webview Zalo, PWA iOS chặn tải file) — mà lúc đó thì đã không còn đường về.
 * Cửa `accept` chỉ mở khi chính bản xuất đó không nhập lại được: ghi đè lúc ấy là mất hẳn dữ liệu
 * đang có, nên phải nói ra thay vì chặn cứng — chặn thì người bán không nhập được mà cũng không có
 * cách nào đi tiếp.
 */
type Picked = { file: BackupFile; sourceName: string }
type Choices = Partial<Record<string, PaymentChoice>>
type MergeState = Picked & { current: BackupData; choices: Choices }
type ImportStep =
  | ({ phase: 'mode' } & Picked)
  | ({ phase: 'legacy' } & Picked)
  | ({ phase: 'merge'; notice: string | null } & MergeState)
  | ({ phase: 'merge-safety'; fingerprints: string[]; saved: SavedFile } & MergeState)
  | ({ phase: 'confirm'; current: BackupCounts } & Picked)
  | ({ phase: 'safety'; saved: BackupOutcome; problem: string | null } & Picked)
  | ({ phase: 'accept'; saved: BackupOutcome; problem: string } & Picked)

/** Lỗi chốt chặn trong khoá ghi (hai tab đua nhau) dịch sang đúng câu giải thích, không câu kỹ thuật. */
const restoreError = (caught: unknown) =>
  caught instanceof RestoreBlockedError ? RESTORE_BLOCK_TEXT[caught.reason] : message(caught)

export function SaoLuuPage() {
  const block = useRestoreBlock()
  const identity = useDeviceIdentity()
  // Cùng chữ dự phòng với khoá gộp (`mergeAllDataAndRecalculate`), để mã mới trên xem trước khớp lúc ghi.
  const fallbackLetter = identity?.letter ?? 'B'
  const lastBackup = useLastBackupLine()
  // Đọc một lần lúc mount, xoá trong effect: StrictMode mount hai lần, đọc-và-xoá cùng chỗ thì lần mount
  // thứ hai mất thẻ.
  const [restoreReport] = useState(readRestoreReport)
  const fileInput = useRef<HTMLInputElement>(null)
  const exportButton = useRef<HTMLButtonElement>(null)
  const exportLock = useRef(false)
  const emptyBackupLock = useRef(false)
  const pendingEmptyBackupRef = useRef<PreparedBackup | null>(null)
  const shareLock = useRef(false)
  const shareTargetRef = useRef<PreparedBackup | null>(null)

  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<ImportStep | null>(null)
  const [pendingEmptyBackup, setPendingEmptyBackup] = useState<PreparedBackup | null>(null)
  const [shareTarget, setShareTarget] = useState<PreparedBackup | null>(null)
  const modalOpen = pendingEmptyBackup !== null || step !== null

  useEffect(() => clearRestoreReport(), [])

  const clearShareTarget = useCallback((expected: PreparedBackup | null = null) => {
    if (expected !== null && shareTargetRef.current !== expected) return

    shareTargetRef.current = null
    setShareTarget((rendered) => (expected === null || rendered === expected ? null : rendered))
  }, [])

  useEffect(() => {
    const onPageHide = () => clearShareTarget()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [clearShareTarget])

  useEffect(() => {
    if (shareTarget === null) return
    const timeout = window.setTimeout(() => clearShareTarget(shareTarget), SHARE_TARGET_LIFETIME_MS)
    return () => window.clearTimeout(timeout)
  }, [clearShareTarget, shareTarget])

  const finishManualDownload = async (prepared: PreparedBackup) => {
    setNotice(describeSavedFile(await downloadPreparedBackup(prepared)))
    if (canSharePreparedBackup(prepared)) {
      shareTargetRef.current = prepared
      setShareTarget(prepared)
    }
  }

  const requestResync = async () => {
    setBusy(true)
    setError(null)
    try {
      await requestFullResync()
      setNotice('Đang kéo lại toàn bộ sổ chung…')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const runExport = async () => {
    if (
      exportLock.current ||
      emptyBackupLock.current ||
      pendingEmptyBackupRef.current !== null ||
      step !== null
    ) return
    exportLock.current = true
    clearShareTarget()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const prepared = await prepareBackup(Date.now())
      if (!prepared.importable) {
        const outcome = await downloadPreparedBackup(prepared)
        // Nói thẳng là file này không dùng để phục hồi được. Im lặng ở đây thì người bán yên tâm với
        // một file rỗng nghĩa, và chỉ biết vào đúng lúc mất dữ liệu.
        setError(
          `${describeSavedFile(outcome)} Nhưng file này KHÔNG nhập lại được: ${outcome.problem} Sổ vẫn tính là chưa sao lưu.`,
        )
      } else if (isOperationallyEmpty(prepared.counts)) {
        pendingEmptyBackupRef.current = prepared
        setPendingEmptyBackup(prepared)
      } else {
        await finishManualDownload(prepared)
      }
    } catch (caught) {
      setError(message(caught))
    } finally {
      exportLock.current = false
      setBusy(false)
    }
  }

  const cancelEmptyBackup = (prepared: PreparedBackup) => {
    if (emptyBackupLock.current || pendingEmptyBackupRef.current !== prepared) return
    pendingEmptyBackupRef.current = null
    setPendingEmptyBackup((current) => (current === prepared ? null : current))
  }

  const confirmEmptyBackup = async (prepared: PreparedBackup) => {
    if (emptyBackupLock.current || pendingEmptyBackupRef.current !== prepared) return
    emptyBackupLock.current = true
    setBusy(true)
    setError(null)
    try {
      await finishManualDownload(prepared)
    } catch (caught) {
      setError(message(caught))
    } finally {
      emptyBackupLock.current = false
      pendingEmptyBackupRef.current = null
      setBusy(false)
      setPendingEmptyBackup((current) => (current === prepared ? null : current))
    }
  }

  const runShare = async (target: PreparedBackup) => {
    if (shareLock.current || shareTargetRef.current !== target) return
    shareLock.current = true
    // Gọi ngay trong click, trước mọi await, để iOS không thu hồi quyền mở native share sheet.
    const outcomePromise = sharePreparedBackup(target)
    setSharing(true)
    setError(null)
    try {
      const outcome = await outcomePromise
      if (outcome === 'shared') clearShareTarget(target)
      else if (outcome === 'failed' && shareTargetRef.current === target) setError(SHARE_FAILURE_MESSAGE)
    } finally {
      shareLock.current = false
      setSharing(false)
    }
  }

  // Đọc và kiểm file xong mới hỏi; tới đây DB vẫn chưa bị đụng tới.
  const pickFile = async (file: File) => {
    if (pendingEmptyBackupRef.current !== null || step !== null) return
    clearShareTarget()
    setError(null)
    setNotice(null)
    try {
      setStep({ phase: 'mode', file: await readBackupFile(file), sourceName: file.name })
    } catch (caught) {
      setError(message(caught))
    }
  }

  const chooseOverwrite = async ({ file, sourceName }: Picked) => {
    setStep(null)
    try {
      setStep({ phase: 'confirm', file, sourceName, current: await currentCounts(Date.now()) })
    } catch (caught) {
      setError(message(caught))
    }
  }

  /** Đọc sổ trên máy **một lần**: xem trước và dấu vân tay gửi vào khoá đều tính trên đúng bản này. */
  const openMerge = async (picked: Picked, notice: string | null = null, choices: Choices = {}) => {
    try {
      const current = await readLedger()
      setStep({ ...picked, current, choices, notice, phase: 'merge' })
    } catch (caught) {
      setStep(null)
      setError(message(caught))
    }
  }

  const chooseMerge = (picked: Picked) => {
    if (isLegacyFile(picked.file)) setStep({ ...picked, phase: 'legacy' })
    else void openMerge(picked)
  }

  /** File an toàn trước khi gộp (D11). APK lưu xong là gộp luôn; web dừng ở cửa "Đã thấy file an toàn". */
  const startMerge = async (state: MergeState, fingerprints: string[]) => {
    setBusy(true)
    const saved = await saveSafetyFile().catch((caught: unknown) => {
      setStep({ ...state, notice: message(caught), phase: 'merge' })
      setBusy(false)
      return null
    })
    if (saved === null) return
    if (saved.verified) {
      await runMerge(state, fingerprints, saved)
      return
    }
    setStep({ ...state, fingerprints, saved, phase: 'merge-safety' })
    setBusy(false)
  }

  const runMerge = async (state: MergeState, fingerprints: string[], saved: SavedFile) => {
    const { file, sourceName, choices } = state
    setStep({ ...state, notice: null, phase: 'merge' })
    setBusy(true)
    try {
      const answers = Object.fromEntries(
        Object.entries(choices).filter((entry): entry is [string, PaymentChoice] => entry[1] !== undefined),
      )
      const { report, summary } = await applyMerge(file.data, answers, fingerprints)
      saveRestoreReport({
        mode: 'merge',
        sourceName,
        safety: { savedAs: saved.savedAs, location: saved.location },
        codeChanges: summary.codeChanges.length,
        report,
      })
      window.location.reload()
    } catch (caught) {
      setBusy(false)
      if (caught instanceof RestoreBlockedError) {
        setStep(null)
        setError(RESTORE_BLOCK_TEXT[caught.reason])
      } else if (caught instanceof MergeReviewError) {
        // Sổ đổi (hoặc lựa chọn làm sổ hỏng): đọc lại sổ, chỉ giữ câu trả lời của xung đột còn y nguyên.
        const current = await readLedger()
        const unchanged = new Set(
          findPaymentConflicts(current, file.data)
            .filter((conflict) => fingerprints.includes(conflict.fingerprint))
            .map((conflict) => conflict.gid),
        )
        const kept = Object.fromEntries(Object.entries(choices).filter(([gid]) => unchanged.has(gid)))
        setStep({ phase: 'merge', file, sourceName, current, choices: kept, notice: caught.message })
      } else {
        setStep({ ...state, notice: message(caught), phase: 'merge' })
      }
    }
  }

  /** Xuất bản hiện tại ra file rồi dừng lại hỏi — chưa xoá gì cả. */
  const saveSafetyCopy = async ({ file, sourceName }: Picked) => {
    setStep(null)
    setBusy(true)
    try {
      const saved = await exportBackup(Date.now())
      setStep({ phase: 'safety', file, sourceName, saved, problem: saved.problem })
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async ({ file, sourceName }: Picked, saved: BackupOutcome) => {
    setStep(null)
    setBusy(true)
    try {
      const report = await applyBackup(file.data)
      saveRestoreReport({
        mode: 'overwrite',
        sourceName,
        safety: { savedAs: saved.savedAs, location: saved.location },
        codeChanges: 0,
        report,
      })
      window.location.reload()
    } catch (caught) {
      setError(restoreError(caught))
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="flex min-h-full flex-col"
        inert={modalOpen}
        aria-hidden={modalOpen || undefined}
      >
        <ScreenHeader title="Sao lưu & khôi phục" back="back" />
        <BackupBanner />
        {restoreReport ? <RestoreReportCard stored={restoreReport} /> : null}

        <section className="px-4 py-5">
          <Button
            ref={exportButton}
            size="cta"
            disabled={busy || modalOpen}
            onClick={() => void runExport()}
          >
            {busy ? 'Đang xử lý…' : 'SAO LƯU RA FILE'}
          </Button>
          <p className="mt-2 text-[13px] text-muted">{lastBackup}</p>
          <p className="mt-2 text-[13px] text-muted">
            Sau khi sao lưu, hãy kiểm tra thư mục Tải về. Thiết bị có thể đổi tên file nếu bị trùng.
            Gửi nó qua Zalo cho chính mình hoặc lưu lên Google Drive — để trên máy thì mất máy là mất luôn.
          </p>

          {notice ? <p className="mt-3 text-[13px] font-semibold text-brand">{notice}</p> : null}
          {error ? (
            <p role="alert" className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          {shareTarget ? (
            <div className="mt-3">
              <Button
                variant="secondary"
                className="w-full"
                disabled={sharing}
                onClick={() => void runShare(shareTarget)}
              >
                {sharing ? 'Đang mở chia sẻ…' : 'CHIA SẺ FILE VỪA SAO LƯU'}
              </Button>
              <p className="mt-2 text-[13px] text-muted">
                File này chứa toàn bộ sổ và thông tin khách hàng. Chỉ gửi cho chính bạn hoặc một nơi
                bạn tin cậy.
              </p>
            </div>
          ) : null}

          <div className="mt-4">
            {/* Chưa đọc xong lý do chặn thì chưa vẽ gì: máy đã ghép không được thấy nút nhập dù chỉ một nhịp. */}
            {block === undefined ? null : block !== null ? (
              <>
                <p className="rounded-btn bg-warn-tint px-3 py-2 text-[13px] text-warn">{RESTORE_BLOCK_TEXT[block]}</p>
                {block === 'connected' ? (
                  <div className="mt-3">
                    <Button variant="secondary" disabled={busy || modalOpen} onClick={() => void requestResync()}>
                      Kéo lại từ đầu
                    </Button>
                    <p className="mt-2 text-[13px] text-muted">
                      Xoá bản sao trên máy này rồi tải lại từ sổ chung. Không ảnh hưởng máy khác.
                    </p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <Button variant="secondary" disabled={busy || modalOpen} onClick={() => fileInput.current?.click()}>
                  Nhập từ file sao lưu
                </Button>
                {/* Không đặt `accept`: file đi qua Zalo/Drive về máy thường mang MIME
                    `application/octet-stream` hoặc mất đuôi `.json`, và bộ chọn file Android làm mờ nó.
                    `readBackupFile` kiểm nội dung trước khi chạm DB, nên không lọc theo tên ở đây. */}
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  aria-label="Chọn file sao lưu"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // Xoá giá trị để chọn lại đúng file vừa chọn vẫn kích hoạt onChange.
                    event.target.value = ''
                    if (file) void pickFile(file)
                  }}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {pendingEmptyBackup ? (
        <ConfirmDialog
          title="Bản sao này chưa có dữ liệu bán hàng"
          message="Bản sao này chưa có đơn, mặt hàng, khách hàng, khoản chi hoặc giá riêng còn dùng được, nhưng vẫn có thể chứa thông tin cửa hàng, nhóm mặt hàng, loại chi phí và các cài đặt. Nếu dùng iPhone, hãy đóng Safari rồi mở app từ biểu tượng trên Màn hình chính nơi bạn vẫn thấy sổ, sau đó sao lưu lại."
          confirmLabel={busy ? 'Đang tải…' : 'Vẫn tải bản sao này'}
          onConfirm={() => void confirmEmptyBackup(pendingEmptyBackup)}
          onCancel={() => cancelEmptyBackup(pendingEmptyBackup)}
          returnFocusRef={exportButton}
          pending={busy}
        />
      ) : null}

      {step?.phase === 'mode' ? (
        <Sheet title="Khôi phục từ file" onClose={() => setStep(null)}>
          <p className="text-[15px]">
            File “{step.sourceName}” có {describeCounts(countRecords(step.file.data))}.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Button variant="danger" onClick={() => void chooseOverwrite(step)}>
              Ghi đè
            </Button>
            <p className="text-[13px] text-muted">
              Thay toàn bộ sổ trên máy bằng file. Mất phần đang có trên máy mà file không có.
            </p>
            <Button variant="secondary" onClick={() => chooseMerge(step)}>
              Gộp vào sổ trên máy
            </Button>
            <p className="text-[13px] text-muted">
              Thêm vào máy những gì chỉ có trong file; cùng một dòng thì lấy bản mới hơn. Không xoá gì. Khoản
              thu khác nhau giữa máy và file sẽ hỏi bạn từng khoản.
            </p>
          </div>
        </Sheet>
      ) : null}

      {step?.phase === 'legacy' ? (
        <ConfirmDialog
          title="File từ bản cũ — gộp sẽ nhân đôi"
          message="File này từ bản cũ, không có mã toàn cục. Gộp sẽ nhân đôi mọi đơn, khách, món, khoản thu đã có trên máy, và nợ có thể bị tính hai lần. Thường nên chọn Ghi đè."
          confirmLabel="Vẫn gộp"
          onConfirm={() => void openMerge(step)}
          onCancel={() => setStep({ phase: 'mode', file: step.file, sourceName: step.sourceName })}
        />
      ) : null}

      {step?.phase === 'merge' ? (
        <MergePreviewSheet
          current={step.current}
          incoming={step.file.data}
          choices={step.choices}
          fallbackLetter={fallbackLetter}
          notice={step.notice}
          busy={busy}
          onChoose={(gid, choice) => setStep({ ...step, choices: { ...step.choices, [gid]: choice } })}
          onMerge={(fingerprints) => void startMerge(step, fingerprints)}
          onClose={() => {
            if (!busy) setStep(null)
          }}
        />
      ) : null}

      {step?.phase === 'merge-safety' ? (
        <ConfirmDialog
          title="Đã thấy file an toàn trong Tải về?"
          message={`${describeSavedFile(step.saved)} Mở thư mục Tải về, thấy file rồi mới bấm tiếp — gộp xong trang sẽ tự tải lại.`}
          confirmLabel="Đã thấy — gộp"
          onConfirm={() => void runMerge(step, step.fingerprints, step.saved)}
          onCancel={() =>
            setStep({
              phase: 'merge',
              file: step.file,
              sourceName: step.sourceName,
              current: step.current,
              choices: step.choices,
              notice: null,
            })
          }
        />
      ) : null}

      {step?.phase === 'confirm' ? (
        <ConfirmDialog
          title="Ghi đè toàn bộ dữ liệu?"
          message={`File có ${describeCounts(countRecords(step.file.data))}.${describeDroppedPrices(step.file.data)} Đang có trên máy: ${describeCounts(step.current)}. Toàn bộ dữ liệu đang có trên máy sẽ bị thay thế — mất phần chưa có trong file. App sẽ tải một file sao lưu của dữ liệu hiện tại về máy trước.`}
          confirmLabel="Tải file an toàn"
          onConfirm={() => void saveSafetyCopy(step)}
          onCancel={() => setStep(null)}
        />
      ) : null}

      {step?.phase === 'safety' ? (
        <ConfirmDialog
          title="Đã thấy file trong máy chưa?"
          message={
            step.problem === null
              ? `${describeSavedFile(step.saved)} Mở file trong thư mục Tải về trước khi bấm tiếp. Sau bước này dữ liệu đang có trên máy không lấy lại được.`
              : `${describeSavedFile(step.saved)} Mở file trong thư mục Tải về. Bản sao này có chỗ hỏng, còn một bước nữa phải đọc.`
          }
          confirmLabel={step.problem === null ? 'Đã thấy — ghi đè' : 'Đã thấy — đọc tiếp'}
          onConfirm={() =>
            step.problem === null
              ? void runImport(step, step.saved)
              : setStep({ phase: 'accept', file: step.file, sourceName: step.sourceName, saved: step.saved, problem: step.problem })
          }
          onCancel={() => setStep(null)}
        />
      ) : null}

      {step?.phase === 'accept' ? (
        <ConfirmDialog
          title="Bản sao an toàn KHÔNG nhập lại được"
          message={`${step.problem} Ghi đè bây giờ là mất hẳn dữ liệu đang có; bản sao "${step.saved.savedAs}" không dựng lại được. Muốn giữ đường về thì bấm Huỷ, mở file ra sửa tay đúng chỗ đó, rồi ghi đè sau.`}
          confirmLabel="Vẫn ghi đè — mất cũng được"
          onConfirm={() => void runImport(step, step.saved)}
          onCancel={() => setStep(null)}
        />
      ) : null}
    </>
  )
}
