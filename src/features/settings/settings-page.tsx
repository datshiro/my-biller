import { type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AppUpdateSection } from './app-update-section'
import { LabelPrinterSection } from './label-printer-section'
import { BtReceiverSection } from './bt-receiver-section'
import { PrinterSection } from './printer-section'
import { isNativeApp } from '../printer/printer-sink'
import { BackupBanner } from './backup-banner'
import { DangerZone } from './danger-zone'
import { formatBytes, useStorageStatus } from './storage-status'
import { useDeviceConnection, useDeviceIdentity, useInstallId, useLastBackupLine } from './use-settings'
import { shortId } from '@/domain/short-id'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { ListRow } from '@/ui/list-row'
import { ScreenHeader } from '@/ui/screen-header'

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
  const lastBackup = useLastBackupLine()
  const identity = useDeviceIdentity()
  const connection = useDeviceConnection()
  const installId = useInstallId()
  const { status, pinning, pin } = useStorageStatus()

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Cài đặt" back="back" />
      <BackupBanner />

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

      <Section title="MÁY IN">
        <PrinterSection />
      </Section>

      <Section title="MÁY IN TEM">
        <LabelPrinterSection />
      </Section>

      <Section title="NHẬN IN QUA BLUETOOTH">
        <BtReceiverSection />
      </Section>

      {/* Trong APK "bản mới" của Service Worker là vô nghĩa — cập nhật app bằng cài đè APK (D15). */}
      {isNativeApp() ? null : (
        <Section title="CẬP NHẬT APP">
          <AppUpdateSection />
        </Section>
      )}

      <div className="border-t border-line">
        <ListRow
          title="Sao lưu & khôi phục"
          subtitle={lastBackup}
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/sao-luu')}
        />
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
              ? `${identity.label} · Sổ: ${shortId(connection.shopId)} · Máy ${identity.letter}`
              : installId && identity
                ? `${identity.label} · chữ ${identity.letter} · Mã máy: ${shortId(installId)} · chưa ghép`
                : installId
                  ? `Mã máy: ${shortId(installId)} · chưa ghép`
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
        <ListRow
          title="Nhập từ file"
          subtitle="Món, nhóm và khách từ file CSV (Excel, Google Sheets)"
          right={<span className="text-[20px] text-muted">›</span>}
          onClick={() => void navigate('/them/nhap-file')}
        />
      </div>

      {connection ? null : <DangerZone />}
    </div>
  )
}
