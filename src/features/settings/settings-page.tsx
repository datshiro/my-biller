import { useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router'
import { applyBackup, exportBackup, readBackupFile } from './backup'
import { BackupBanner } from './backup-banner'
import { DangerZone } from './danger-zone'
import { formatBytes, useStorageStatus } from './storage-status'
import { useAppState } from './use-settings'
import { countRecords, describeCounts } from '@/domain/backup'
import type { BackupFile } from '@/domain/schema'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { ListRow } from '@/ui/list-row'
import { ScreenHeader } from '@/ui/screen-header'

const message = (error: unknown) => (error instanceof Error ? error.message : 'Không xong. Thử lại.')

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
  const { status, pinning, pin } = useStorageStatus()
  const fileInput = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<ImportStep | null>(null)

  const runExport = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { filename, importable, problem } = await exportBackup(Date.now())
      if (importable) setNotice(`Đã tải ${filename} về máy.`)
      // Nói thẳng là file này không dùng để phục hồi được. Im lặng ở đây thì người bán yên tâm với
      // một file rỗng nghĩa, và chỉ biết vào đúng lúc mất dữ liệu.
      else setError(`Đã tải ${filename} về máy, nhưng file này KHÔNG nhập lại được: ${problem} Sổ vẫn tính là chưa sao lưu.`)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  // Đọc và kiểm file xong mới hỏi; tới đây DB vẫn chưa bị đụng tới.
  const pickFile = async (file: File) => {
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
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Cài đặt" back="back" />
      <BackupBanner />

      <Section title="SAO LƯU">
        <Button size="cta" disabled={busy} onClick={() => void runExport()}>
          {busy ? 'Đang xử lý…' : 'SAO LƯU RA FILE'}
        </Button>
        <p className="mt-2 text-[13px] text-muted">{lastBackup}</p>
        <p className="mt-2 text-[13px] text-muted">
          File nằm trong thư mục Tải về. Gửi nó qua Zalo cho chính mình hoặc lưu lên Google Drive —
          để trên máy thì mất máy là mất luôn.
        </p>

        {notice ? <p className="mt-3 text-[13px] font-semibold text-brand">{notice}</p> : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-4">
          <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
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

      <DangerZone />

      {step?.phase === 'confirm' ? (
        <ConfirmDialog
          title="Ghi đè toàn bộ dữ liệu?"
          message={`File có ${describeCounts(countRecords(step.file.data))}. Toàn bộ dữ liệu đang có trên máy sẽ bị thay thế. App sẽ tải một file sao lưu của dữ liệu hiện tại về máy trước.`}
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
              ? `Vừa tải "${step.filename}" về thư mục Tải về. Hãy mở ra xem có thật không rồi mới bấm tiếp — sau bước này dữ liệu đang có trên máy không lấy lại được.`
              : `Vừa tải "${step.filename}" về thư mục Tải về. Hãy mở ra xem có thật không — nhưng file này có chỗ hỏng, còn một bước nữa phải đọc.`
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
          title="File an toàn vừa tải về KHÔNG nhập lại được"
          message={`${step.problem} Ghi đè bây giờ là mất hẳn dữ liệu đang có, "${step.filename}" không dựng lại được. Muốn giữ đường về thì bấm Huỷ, mở file ra sửa tay đúng chỗ đó, rồi ghi đè sau.`}
          confirmLabel="Vẫn ghi đè — mất cũng được"
          onConfirm={() => void runImport(step.file)}
          onCancel={() => setStep(null)}
        />
      ) : null}
    </div>
  )
}
