import { useState } from 'react'
import { wipeAfterBackup } from './backup'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

const CONFIRM_WORD = 'XOA'

/**
 * Bắt gõ chữ chứ không chỉ bấm "Đồng ý": xoá sạch là thao tác không có Undo, và người bán đang cầm
 * điện thoại một tay giữa lúc bán hàng. Vẫn xuất file trước khi xoá.
 */
export function DangerZone() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wipe = async () => {
    setBusy(true)
    setError(null)
    try {
      await wipeAfterBackup(Date.now())
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
              onClick={() => void wipe()}
            >
              {busy ? 'Đang xoá…' : 'XOÁ TẤT CẢ'}
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
    </section>
  )
}
