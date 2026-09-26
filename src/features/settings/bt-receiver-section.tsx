import { format } from 'date-fns'
import { useState } from 'react'
import { getBtReceiver, saveBtEnabled, useBtReceiver, type BtReceiver, type JobEntry } from '../printer/bt-receiver'
import { isNativeApp } from '../printer/printer-sink'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'

const STATUS: Record<JobEntry['status'], string> = {
  printing: 'Đang in…',
  printed: 'Đã in',
  failed: 'In hỏng',
}

/**
 * Mục NHẬN IN QUA BLUETOOTH: điện thoại giả làm máy in Bluetooth, phiếu nhận được in ra máy in nhiệt đã cài
 * IP ở mục MÁY IN. Hiện ở mọi nền tảng để Robot lái được; trên web nút BẬT khoá kèm ghi chú như IN THỬ.
 */
export function BtReceiverSection({ receiver = getBtReceiver() }: { receiver?: BtReceiver }) {
  const state = useBtReceiver(receiver)
  const native = isNativeApp()
  const [askReprint, setAskReprint] = useState<JobEntry | null>(null)
  const on = state.phase === 'listening' || state.phase === 'starting'

  const toggle = () => {
    saveBtEnabled(!on)
    void (on ? receiver.stop() : receiver.start())
  }

  const status =
    state.phase === 'starting'
      ? 'Đang mở Bluetooth…'
      : state.phase === 'listening'
        ? state.device
          ? `Đang nhận từ ${state.device}`
          : `Đang chờ máy gửi — ghép Bluetooth với "${state.name ?? 'điện thoại này'}"`
        : null

  return (
    <>
      <p className="text-[13px] text-muted">
        Máy khác ghép Bluetooth với điện thoại này và chọn nó làm máy in. Phiếu nhận được in ngay ra máy in nhiệt ở
        mục MÁY IN. Giữ app mở: app ở nền lâu thì Android có thể dừng nhận.
      </p>
      <Button variant="secondary" className="mt-3" disabled={!native || state.phase === 'starting'} onClick={toggle}>
        {on ? 'TẮT NHẬN IN' : 'BẬT NHẬN IN'}
      </Button>
      {!native ? (
        <p className="mt-2 text-[13px] text-muted">Chỉ nhận in qua Bluetooth trong app Android cài từ file APK.</p>
      ) : null}
      <p aria-live="polite" className={status ? 'mt-2 text-[13px] font-semibold text-brand' : 'sr-only'}>
        {status ?? ''}
      </p>
      {state.phase === 'error' && state.error ? (
        <p role="alert" className="mt-2 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {state.error}
        </p>
      ) : null}

      {state.log.length > 0 ? (
        <ul className="mt-4 space-y-3" aria-label="Phiếu đã nhận">
          {state.log.map((entry) => (
            <li key={entry.id} className="rounded-btn border border-line bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span>
                  {format(entry.at, 'HH:mm:ss')} · {entry.device}
                </span>
                <span className={entry.status === 'failed' ? 'font-semibold text-danger' : 'font-semibold'}>
                  {STATUS[entry.status]}
                </span>
              </div>
              {entry.message ? <p className="mt-1 text-[13px] text-muted">{entry.message}</p> : null}
              {entry.previewUrl ? (
                <img src={entry.previewUrl} alt="Bản xem trước phiếu nhận được" className="mt-2 w-full max-w-[288px] border border-line" />
              ) : null}
              {entry.job && entry.status !== 'printing' ? (
                <Button variant="secondary" className="mt-2" onClick={() => setAskReprint(entry)}>
                  IN LẠI
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {askReprint ? (
        <ConfirmDialog
          title="In lại phiếu này?"
          message={`Phiếu nhận lúc ${format(askReprint.at, 'HH:mm:ss')} từ ${askReprint.device} sẽ in thêm một tờ.`}
          confirmLabel="In lại"
          confirmVariant="primary"
          onConfirm={() => {
            receiver.reprint(askReprint.id)
            setAskReprint(null)
          }}
          onCancel={() => setAskReprint(null)}
        />
      ) : null}
    </>
  )
}
