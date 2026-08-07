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
  const [pending, setPending] = useState<BackupFile | null>(null)

  const runExport = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setNotice(`Đã tải ${await exportBackup(Date.now())} về máy.`)
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
      setPending(await readBackupFile(file))
    } catch (caught) {
      setError(message(caught))
    }
  }

  const runImport = async (file: BackupFile) => {
    setPending(null)
    setBusy(true)
    try {
      await applyBackup(file.data, Date.now())
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

      {pending ? (
        <ConfirmDialog
          title="Ghi đè toàn bộ dữ liệu?"
          message={`File có ${describeCounts(countRecords(pending.data))}. Toàn bộ dữ liệu đang có trên máy sẽ bị thay thế. App sẽ tự tải một file sao lưu của dữ liệu hiện tại về máy trước.`}
          confirmLabel="Nhập và ghi đè"
          onConfirm={() => void runImport(pending)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  )
}
