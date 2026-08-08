import { useState } from 'react'
import { exportSafetyCopy, wipeEverything } from './backup'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

const CONFIRM_WORD = 'XOA'

/**
 * Bắt gõ chữ chứ không chỉ bấm "Đồng ý": xoá sạch là thao tác không có Undo, và người bán đang cầm
 * điện thoại một tay giữa lúc bán hàng. Xuất file trước khi xoá, và bắt xác nhận đã **thấy** file —
 * cú tải có thể bị webview nuốt mất mà không báo gì.
 */
export function DangerZone() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveSafetyCopy = async () => {
    setBusy(true)
    setError(null)
    try {
      setSaved(await exportSafetyCopy(Date.now()))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không sao lưu được. Chưa xoá gì cả.')
    } finally {
      setBusy(false)
    }
  }

  const wipe = async () => {
    setSaved(null)
    setBusy(true)
    try {
      await wipeEverything()
      window.location.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xoá được. Thử lại.')
      setBusy(false)
    }
  }

  return (
    <section className="px-4 py-5">
      <h2 className="label-xs text-muted">NGUY HIỂM</h2>
      <p className="mt-2 text-[13px] text-muted">
        Xoá toàn bộ đơn, mặt hàng, khách hàng, chi phí trên máy này. Không khôi phục được, trừ khi
        nhập lại từ file sao lưu.
      </p>
      <div className="mt-3">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Xoá toàn bộ dữ liệu
        </Button>
      </div>

      {open ? (
        <Sheet
          title="Xoá toàn bộ dữ liệu"
          onClose={() => setOpen(false)}
          footer={
            <Button
              size="cta"
              variant="danger"
              disabled={busy || typed.trim().toUpperCase() !== CONFIRM_WORD}
              onClick={() => void saveSafetyCopy()}
            >
              {busy ? 'Đang xử lý…' : 'SAO LƯU RỒI XOÁ'}
            </Button>
          }
        >
          <p className="text-[15px]">
            App sẽ tải một file sao lưu về máy trước, rồi mới xoá. Gõ <b>{CONFIRM_WORD}</b> để xác
            nhận.
          </p>
          <div className="mt-4">
            <TextField
              label={`Gõ ${CONFIRM_WORD}`}
              value={typed}
              autoFocus
              autoCapitalize="characters"
              onChange={(event) => setTyped(event.target.value)}
              error={error ?? undefined}
            />
          </div>
        </Sheet>
      ) : null}

      {saved ? (
        <ConfirmDialog
          title="Đã thấy file trong máy chưa?"
          message={`Vừa tải "${saved}" về thư mục Tải về. Mở ra xem có thật không rồi mới bấm tiếp — sau bước này không lấy lại được gì.`}
          confirmLabel="Đã thấy — xoá tất cả"
          onConfirm={() => void wipe()}
          onCancel={() => setSaved(null)}
        />
      ) : null}
    </section>
  )
}
