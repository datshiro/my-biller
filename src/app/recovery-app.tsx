import { useEffect, useRef, useState } from 'react'
import { PwaUpdatePrompt } from './pwa-update-prompt'
import {
  downloadRecoveryBackup,
  prepareBackup,
  type PreparedBackup,
} from '@/features/settings/backup'
import { describeCounts, isOperationallyEmpty } from '@/domain/backup'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'

const message = (caught: unknown) =>
  caught instanceof Error ? caught.message : 'Không đọc được dữ liệu trong máy.'

export function RecoveryApp() {
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const downloadLock = useRef(false)

  useEffect(() => {
    let active = true
    void prepareBackup(Date.now())
      .then((snapshot) => {
        if (active) setPrepared(snapshot)
      })
      .catch((caught) => {
        if (active) setError(message(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const download = async (allowEmpty: boolean) => {
    if (!prepared || downloadLock.current) return
    if (!allowEmpty && isOperationallyEmpty(prepared.counts)) {
      setConfirmingEmpty(true)
      return
    }

    downloadLock.current = true
    setDownloading(true)
    setConfirmingEmpty(false)
    setError(null)
    setNotice(null)
    try {
      const outcome = await downloadRecoveryBackup(prepared)
      if (outcome.importable) {
        setNotice(
          `Đã gửi yêu cầu tải bản sao với tên đề xuất "${outcome.filename}". Kiểm tra thư mục Tải về trước khi đóng màn hình này.`,
        )
      } else {
        setError(
          `Đã gửi yêu cầu tải "${outcome.filename}", nhưng file chưa nhập lại được: ${outcome.problem} Giữ file để sửa dữ liệu thủ công.`,
        )
      }
    } catch (caught) {
      setError(message(caught))
    } finally {
      downloadLock.current = false
      setDownloading(false)
    }
  }

  return (
    <main data-app-mode="recovery" className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <div className="bg-danger px-4 py-3 text-center text-[13px] font-bold text-white">
        CHẾ ĐỘ PHỤC HỒI — KHÔNG BÁN HÀNG
      </div>

      <div className="flex flex-1 flex-col gap-5 p-5">
        <header>
          <p className="label-xs text-danger">Công cụ sự cố</p>
          <h1 className="mt-1 text-[24px] font-bold">Phục hồi dữ liệu — chỉ đọc</h1>
          <p className="mt-2 text-[15px] text-muted">
            Màn hình này chỉ đọc sổ đang nằm trong máy và tải file sao lưu. Không có bán hàng, nhập
            file, ghép máy hay kéo lại sổ chung.
          </p>
        </header>

        <section className="rounded-card border border-danger/25 bg-danger-tint p-4">
          <h2 className="font-bold text-danger">Trước khi tiếp tục</h2>
          <p className="mt-1 text-[14px]">
            Đóng tất cả tab Safari và app my-biller trên Màn hình chính ở máy này. Chỉ giữ màn hình
            phục hồi đang mở để tránh một bản cũ tiếp tục đồng bộ.
          </p>
        </section>

        <section className="rounded-card border border-line p-4" aria-live="polite">
          <h2 className="label-xs text-muted">Dữ liệu đọc được</h2>
          {loading ? (
            <p className="mt-2">Đang mở sổ schema v5…</p>
          ) : prepared ? (
            <>
              <p className="mt-2 font-semibold">{describeCounts(prepared.counts)}</p>
              {prepared.importable ? (
                <p className="mt-1 text-[13px] text-muted">Snapshot qua kiểm tra và có thể nhập lại.</p>
              ) : (
                <p className="mt-1 text-[13px] text-danger">
                  Snapshot có lỗi định dạng: {prepared.problem}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-danger">Không tạo được snapshot.</p>
          )}
        </section>

        {error ? <p role="alert" className="rounded-btn bg-danger-tint p-3 text-danger">{error}</p> : null}
        {notice ? <p role="status" className="rounded-btn bg-brand-tint p-3 font-semibold">{notice}</p> : null}

        <div className="mt-auto">
          <Button
            size="cta"
            disabled={!prepared || loading || downloading}
            onClick={() => void download(false)}
          >
            {downloading ? 'ĐANG TẠO FILE…' : 'TẢI FILE SAO LƯU'}
          </Button>
          <p className="mt-2 text-center text-[13px] text-muted">
            Recovery không ghi mốc sao lưu và không tạo thay đổi chờ đồng bộ.
          </p>
        </div>
      </div>

      <PwaUpdatePrompt />

      {confirmingEmpty && prepared ? (
        <ConfirmDialog
          title="Bản sao chưa có dữ liệu bán hàng"
          message="Snapshot này có 0 đơn, 0 mặt hàng, 0 khách, 0 khoản chi và 0 giá riêng. Hãy kiểm tra bạn đang mở đúng Safari hoặc app trên Màn hình chính có sổ cần cứu. Chỉ tải tiếp nếu đây đúng là kho dữ liệu cần kiểm tra."
          confirmLabel="VẪN TẢI FILE"
          pending={downloading}
          onConfirm={() => void download(true)}
          onCancel={() => setConfirmingEmpty(false)}
        />
      ) : null}
    </main>
  )
}
