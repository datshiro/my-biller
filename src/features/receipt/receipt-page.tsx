import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import './receipt.css'
import { ReceiptView } from './receipt-view'
import { receiptToText } from './receipt-text'
import { canShareReceipt, downloadReceipt, renderReceiptPng, shareReceipt } from './share-receipt'
import { receiptSignature, useReceipt } from './use-receipt'
import { paginateLines } from '@/domain/receipt-pages'
import { Button } from '@/ui/button'
import { EmptyState } from '@/ui/empty-state'

type Png = { blobs: Blob[]; canShare: boolean }

export function ReceiptPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const data = useReceipt(Number(id))
  const signature = receiptSignature(data)

  const captureRefs = useRef<(HTMLDivElement | null)[]>([])
  const [png, setPng] = useState<Png | null>(null)
  const [pngError, setPngError] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Nội dung phiếu đổi thì ảnh cũ hết giá trị — dọn ngay trong lúc render, không đợi effect,
  // để không có nhịp nào nút "Chia sẻ" cầm ảnh của phiếu cũ.
  const [renderedFor, setRenderedFor] = useState<string | null>(null)
  if (signature !== renderedFor) {
    setRenderedFor(signature)
    setPng(null)
    setPngError(false)
  }

  useEffect(() => {
    if (signature === null) return
    let cancelled = false

    void (async () => {
      try {
        const nodes = captureRefs.current.filter((node): node is HTMLDivElement => node !== null)
        if (nodes.length === 0) return
        // Chụp tuần tự: mỗi lần chụp dựng một canvas cỡ triệu điểm ảnh, làm song song thì máy yếu
        // dễ hết bộ nhớ và trả về blob rỗng.
        const blobs: Blob[] = []
        for (const node of nodes) blobs.push(await renderReceiptPng(node))
        if (!cancelled) setPng({ blobs, canShare: canShareReceipt(blobs, 'phieu') })
      } catch {
        if (!cancelled) setPngError(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signature])

  if (data === undefined) return <p className="p-6 text-center text-muted">Đang mở phiếu…</p>
  if (data === null) {
    return (
      <EmptyState
        message="Không tìm thấy đơn này. Có thể nó đã bị xoá."
        actionLabel="Về danh sách đơn"
        onAction={() => void navigate('/don', { replace: true })}
      />
    )
  }

  const { order, shop } = data
  const pages = paginateLines(data.lines)
  // Gửi 3 tấm ảnh khác hẳn gửi 1 — nói trước trên nút, đừng để người bán phát hiện lúc Zalo đã mở.
  const pageSuffix = pages.length > 1 ? ` (${pages.length} tấm)` : ''

  const onShare = async () => {
    if (!png) return
    const outcome = await shareReceipt(png.blobs, order.code, order.code)
    if (outcome === 'downloaded') setNotice('Máy không gửi thẳng được ảnh — đã tải ảnh về. Mở Zalo rồi đính kèm ảnh vừa tải.')
    if (outcome === 'shared') setNotice(null)
  }

  const onCopyText = async () => {
    try {
      await navigator.clipboard.writeText(receiptToText(data))
      setNotice('Đã chép nội dung phiếu. Dán thẳng vào Zalo được.')
    } catch {
      setNotice('Trình duyệt không cho chép tự động. Bạn chọn chữ trong phiếu rồi chép tay nhé.')
    }
  }

  const busy = png === null && !pngError

  return (
    <div className="receipt-screen flex h-dvh flex-col bg-surface">
      <header className="no-print flex items-center gap-1 border-b border-line bg-white px-2 py-2.5">
        <button
          type="button"
          onClick={() => void navigate(-1)}
          aria-label="Quay lại"
          className="grid size-12 shrink-0 place-items-center rounded-btn text-[22px] active:bg-surface"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[20px] font-bold">Phiếu bán hàng</h1>
        <Link to={`/don/${order.id}`} className="shrink-0 px-3 py-2 font-semibold text-brand">
          Chi tiết
        </Link>
      </header>

      <div className="receipt-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Hiện đúng những tấm sẽ gửi đi, không giấu bản chụp ở đâu khác — thấy sao gửi vậy.
            Cho vuốt ngang: tờ phiếu rộng cố định 360px để ảnh PNG giống nhau trên mọi máy, nên trên
            màn 320px nó phải trượt được chứ không phải bị cắt mất mép phải. */}
        <div className="space-y-4 overflow-x-auto py-4">
          {pages.map((pageLines, index) => (
            <div
              key={index}
              className="receipt-frame mx-auto w-fit rounded-card border border-line shadow-sm"
            >
              <ReceiptView
                {...data}
                lines={pageLines}
                page={index + 1}
                pageCount={pages.length}
                innerRef={(node) => {
                  captureRefs.current[index] = node
                }}
              />
            </div>
          ))}
        </div>

        {!shop.name ? (
          <div className="no-print px-4 pb-2">
            <Link
              to="/them"
              className="block rounded-btn border border-dashed border-line bg-white px-4 py-3 text-center font-semibold text-brand"
            >
              ＋ Thêm tên quán vào phiếu
            </Link>
          </div>
        ) : null}

        <div className="no-print px-4 pb-6">
          {notice ? (
            <p role="status" className="mb-3 rounded-btn bg-warn-tint px-3 py-2 text-[13px] text-warn">
              {notice}
            </p>
          ) : null}
          {pngError ? (
            <p role="status" className="mb-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] text-danger">
              Không tạo được ảnh phiếu trên máy này. Vẫn in hoặc lưu PDF được.
            </p>
          ) : null}

          {png?.canShare !== false && !pngError ? (
            <Button size="cta" disabled={busy} onClick={() => void onShare()} className="mb-3">
              {busy ? 'Đang chuẩn bị ảnh…' : `📤 CHIA SẺ QUA ZALO${pageSuffix}`}
            </Button>
          ) : (
            <Button
              size="cta"
              disabled={!png}
              onClick={() => png && downloadReceipt(png.blobs, order.code)}
              className="mb-3"
            >
              ⬇ TẢI ẢNH PHIẾU{pageSuffix}
            </Button>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
              🖨 In / Lưu PDF
            </Button>
            {png?.canShare === false || pngError ? (
              <Button variant="secondary" className="flex-1" onClick={() => void onCopyText()}>
                📋 Chép nội dung
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!png}
                onClick={() => png && downloadReceipt(png.blobs, order.code)}
              >
                ⬇ Tải ảnh
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
