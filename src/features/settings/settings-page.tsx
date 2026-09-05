import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router'
import {
  applyBackup,
  canSharePreparedBackup,
  downloadPreparedBackup,
  exportBackup,
  prepareBackup,
  readBackupFile,
  sharePreparedBackup,
  type PreparedBackup,
} from './backup'
import { BackupBanner } from './backup-banner'
import { DangerZone } from './danger-zone'
import { formatBytes, useStorageStatus } from './storage-status'
import { useAppState, useDeviceConnection, useDeviceIdentity } from './use-settings'
import {
  countRecords,
  describeCounts,
  describeDroppedPrices,
  isOperationallyEmpty,
} from '@/domain/backup'
import type { BackupFile } from '@/domain/schema'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListRow } from '@/ui/list-row'
import { ScreenHeader } from '@/ui/screen-header'
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
type ImportStep =
  | { phase: 'confirm'; file: BackupFile }
  | { phase: 'safety'; file: BackupFile; filename: string; problem: string | null }
  | { phase: 'accept'; file: BackupFile; filename: string; problem: string }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-5">
      <h2 className="label-xs text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const state = useAppState()
  const identity = useDeviceIdentity()
  const connection = useDeviceConnection()
  const { status, pinning, pin } = useStorageStatus()
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
    const { filename } = await downloadPreparedBackup(prepared)
    setNotice(
      `Đã gửi yêu cầu tải bản sao với tên đề xuất "${filename}". Hãy kiểm tra thư mục Tải về; thiết bị có thể đổi tên nếu bị trùng.`,
    )
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
        const { filename, problem } = await downloadPreparedBackup(prepared)
        // Nói thẳng là file này không dùng để phục hồi được. Im lặng ở đây thì người bán yên tâm với
        // một file rỗng nghĩa, và chỉ biết vào đúng lúc mất dữ liệu.
        setError(
          `Đã gửi yêu cầu tải bản sao với tên đề xuất "${filename}", nhưng file này KHÔNG nhập lại được: ${problem} Sổ vẫn tính là chưa sao lưu.`,
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
      setStep({ phase: 'confirm', file: await readBackupFile(file) })
    } catch (caught) {
      setError(message(caught))
    }
  }

  /** Xuất bản hiện tại ra file rồi dừng lại hỏi — chưa xoá gì cả. */
  const saveSafetyCopy = async (file: BackupFile) => {
    setStep(null)
    setBusy(true)
    try {
      const { filename, problem } = await exportBackup(Date.now())
      setStep({ phase: 'safety', file, filename, problem })
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (file: BackupFile) => {
    setStep(null)
    setBusy(true)
    try {
      await applyBackup(file.data)
      window.location.reload()
    } catch (caught) {
      setError(message(caught))
      setBusy(false)
    }
  }

  const lastBackup =
    state === undefined
      ? '…'
      : state.lastBackupAt === null
        ? 'Chưa sao lưu lần nào'
        : `Lần cuối: ${format(state.lastBackupAt, "HH:mm 'ngày' d/M/yyyy")}`

  return (
    <>
      <div
        className="flex min-h-full flex-col"
        inert={modalOpen}
        aria-hidden={modalOpen || undefined}
      >
      <ScreenHeader title="Cài đặt" back="back" />
      <BackupBanner />

      <Section title="SAO LƯU">
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
          {connection ? (
            <>
              <Button variant="secondary" disabled={busy || modalOpen} onClick={() => void requestResync()}>
                Kéo lại từ đầu
              </Button>
              <p className="mt-2 text-[13px] text-muted">
                Xoá bản sao trên máy này rồi tải lại từ sổ chung. Không ảnh hưởng máy khác.
              </p>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={busy || modalOpen} onClick={() => fileInput.current?.click()}>
                Nhập từ file sao lưu
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
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
      </Section>

      <Section title="BỘ NHỚ MÁY">
        <div className="flex items-center gap-2">
          <StatusChip tone={status?.persisted ? 'brand' : 'warn'}>
            {status === undefined ? '…' : status.persisted ? 'Đã ghim' : 'Chưa ghim'}
          </StatusChip>
          <span className="text-[13px] text-muted">
            {status === undefined
              ? ''
              : `${status.records} bản ghi${status.usedBytes === null ? '' : ` · ${formatBytes(status.usedBytes)}`}`}
          </span>
        </div>
        {status && !status.persisted ? (
          <>
            <p className="mt-2 text-[13px] text-muted">
              Chưa ghim thì hệ điều hành được phép xoá dữ liệu khi máy hết dung lượng. Sao lưu ra
              file vẫn là cách chắc nhất.
            </p>
            <div className="mt-3">
              <Button variant="secondary" disabled={pinning} onClick={pin}>
                {pinning ? 'Đang xin…' : 'Thử ghim lại'}
              </Button>
            </div>
          </>
        ) : null}
      </Section>

      <div className="border-t border-line">
        <ListRow
          title="Thông tin cửa hàng"
          subtitle="Tên, địa chỉ, SĐT in trên phiếu"
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/cua-hang')}
        />
        <ListRow
          title="Máy bán hàng"
          subtitle={
            connection && identity
              ? `${identity.label} · chữ ${identity.letter} · đã ghép sổ chung`
              : 'Tên máy, chữ cái và ghép vào sổ chung'
          }
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/ghep-may')}
        />
        <ListRow
          title="Đối soát"
          subtitle="So sổ máy này với sổ chung và với máy khác"
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/doi-soat')}
        />
        <ListRow
          title="Nhóm mặt hàng"
          subtitle="Gom món để lọc nhanh khi bán"
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/nhom-mat-hang')}
        />
        <ListRow
          title="Loại chi phí"
          subtitle="Nhãn cho các khoản chi"
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/loai-chi-phi')}
        />
      </div>

      {connection ? null : <DangerZone />}
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

      {step?.phase === 'confirm' ? (
        <ConfirmDialog
          title="Ghi đè toàn bộ dữ liệu?"
          message={`File có ${describeCounts(countRecords(step.file.data))}.${describeDroppedPrices(step.file.data)} Toàn bộ dữ liệu đang có trên máy sẽ bị thay thế. App sẽ tải một file sao lưu của dữ liệu hiện tại về máy trước.`}
          confirmLabel="Tải file an toàn"
          onConfirm={() => void saveSafetyCopy(step.file)}
          onCancel={() => setStep(null)}
        />
      ) : null}

      {step?.phase === 'safety' ? (
        <ConfirmDialog
          title="Đã thấy file trong máy chưa?"
          message={
            step.problem === null
              ? `App vừa yêu cầu tải bản sao với tên đề xuất "${step.filename}". Hãy kiểm tra thư mục Tải về và mở file trước khi bấm tiếp; thiết bị có thể đổi tên nếu bị trùng. Sau bước này dữ liệu đang có trên máy không lấy lại được.`
              : `App vừa yêu cầu tải bản sao với tên đề xuất "${step.filename}". Hãy kiểm tra thư mục Tải về và mở file; thiết bị có thể đổi tên nếu bị trùng. Bản sao này có chỗ hỏng, còn một bước nữa phải đọc.`
          }
          confirmLabel={step.problem === null ? 'Đã thấy — ghi đè' : 'Đã thấy — đọc tiếp'}
          onConfirm={() =>
            step.problem === null
              ? void runImport(step.file)
              : setStep({ phase: 'accept', file: step.file, filename: step.filename, problem: step.problem })
          }
          onCancel={() => setStep(null)}
        />
      ) : null}

      {step?.phase === 'accept' ? (
        <ConfirmDialog
          title="Bản sao an toàn KHÔNG nhập lại được"
          message={`${step.problem} Ghi đè bây giờ là mất hẳn dữ liệu đang có; bản sao có tên đề xuất "${step.filename}" không dựng lại được. Muốn giữ đường về thì bấm Huỷ, mở file ra sửa tay đúng chỗ đó, rồi ghi đè sau.`}
          confirmLabel="Vẫn ghi đè — mất cũng được"
          onConfirm={() => void runImport(step.file)}
          onCancel={() => setStep(null)}
        />
      ) : null}
    </>
  )
}
