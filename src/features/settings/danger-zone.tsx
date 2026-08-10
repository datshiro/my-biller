import { useState } from 'react'
import { exportBackup, wipeEverything } from './backup'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

const CONFIRM_WORD = 'XOA'

/**
 * Cửa cuối trước khi xoá sạch. File sao lưu nhập lại được thì đi qua hai cửa; file không nhập lại
 * được thì thêm cửa thứ ba nói thẳng ra là xoá bây giờ mất hẳn.
 */
type WipeStep =
  | { phase: 'seen'; filename: string; problem: string | null }
  | { phase: 'accept'; filename: string; problem: string }

/**
 * Bắt gõ chữ chứ không chỉ bấm "Đồng ý": xoá sạch là thao tác không có Undo, và người bán đang cầm
 * điện thoại một tay giữa lúc bán hàng. Xuất file trước khi xoá, và bắt xác nhận đã **thấy** file —
 * cú tải có thể bị webview nuốt mất mà không báo gì.
 */
export function DangerZone() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<WipeStep | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveSafetyCopy = async () => {
    setBusy(true)
    setError(null)
    try {
      const { filename, problem } = await exportBackup(Date.now())
      setStep({ phase: 'seen', filename, problem })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không sao lưu được. Chưa xoá gì cả.')
    } finally {
      setBusy(false)
    }
  }

  const wipe = async () => {
    setStep(null)
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
            />
          </div>
          {/* Khe lỗi của ô nhập chỉ dành cho việc gõ sai chữ xác nhận. Lỗi sao lưu / lỗi xoá là
              chuyện khác hẳn, đổ vào đó thì đọc như "chữ XOA sai định dạng". */}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger"
            >
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}

      {step?.phase === 'seen' ? (
        <ConfirmDialog
          title="Đã thấy file trong máy chưa?"
          message={
            step.problem === null
              ? `App vừa yêu cầu tải bản sao với tên đề xuất "${step.filename}". Hãy kiểm tra thư mục Tải về và mở file trước khi bấm tiếp; thiết bị có thể đổi tên nếu bị trùng. Sau bước này không lấy lại được gì.`
              : `App vừa yêu cầu tải bản sao với tên đề xuất "${step.filename}". Hãy kiểm tra thư mục Tải về và mở file; thiết bị có thể đổi tên nếu bị trùng. Bản sao này có chỗ hỏng, còn một bước nữa phải đọc.`
          }
          confirmLabel={step.problem === null ? 'Đã thấy — xoá tất cả' : 'Đã thấy — đọc tiếp'}
          onConfirm={() =>
            step.problem === null
              ? void wipe()
              : setStep({ phase: 'accept', filename: step.filename, problem: step.problem })
          }
          onCancel={() => setStep(null)}
        />
      ) : null}

      {/* Cửa thứ ba, chỉ mở khi file vừa tải về không nhập lại được. Chặn hẳn ở đây thì người bán
          mắc kẹt: không nhập được file mới mà cũng không xoá được để bắt đầu lại. Nên vẫn cho đi,
          nhưng phải nói ra là đi đâu. */}
      {step?.phase === 'accept' ? (
        <ConfirmDialog
          title="Bản sao an toàn KHÔNG nhập lại được"
          message={`${step.problem} Xoá bây giờ là mất hẳn; bản sao có tên đề xuất "${step.filename}" không dựng lại sổ được. Muốn giữ đường về thì bấm Huỷ, mở file ra sửa tay đúng chỗ đó, rồi xoá sau.`}
          confirmLabel="Vẫn xoá — mất cũng được"
          onConfirm={() => void wipe()}
          onCancel={() => setStep(null)}
        />
      ) : null}
    </section>
  )
}
