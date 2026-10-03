import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import './receipt.css'
import { LabelSheet } from './label-sheet'
import { ReceiptView } from './receipt-view'
import { receiptToText } from './receipt-text'
import { canShareReceipt, downloadReceipt, renderReceiptPng, shareReceipt } from './share-receipt'
import { receiptSignature, useReceipt } from './use-receipt'
import { downloadBytes } from '../printer/download-bytes'
import { DEFAULT_LABEL_SIZE, readLabelPrinterConfig } from '../printer/label-config'
import { buildLabelJob, type LabelWatermarkJob } from '../printer/label-job'
import { buildReceiptJob } from '../printer/print-job'
import { readPrinterConfig } from '../printer/printer-config'
import { isAndroidWeb, isNativeApp, nativeSink } from '../printer/printer-sink'
import { buildReceiptRawbtHref } from '../printer/rawbt-href'
import { decodeLogo } from '../settings/shop-logo'
import { labelCopies, labelCount } from '@/domain/label-count'
import { paginateLines } from '@/domain/receipt-pages'
import type { OrderLine } from '@/domain/schema'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { EmptyState } from '@/ui/empty-state'

type Png = { blobs: Blob[]; canShare: boolean }

const MANY_LABELS = 50

export function ReceiptPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const data = useReceipt(Number(id))
  const signature = receiptSignature(data)

  const captureRefs = useRef<(HTMLDivElement | null)[]>([])
  const thermalRef = useRef<HTMLDivElement | null>(null)
  // Khoá đồng bộ chống bấm-đúp: `disabled={busy}` chỉ khoá sau khi React render lại, nên hai cú chạm
  // trong cùng nhịp lọt cả hai → hai phiếu (đã thấy trên SPR02 thật). Ref đặt ngay, cú thứ hai thấy liền.
  const printLock = useRef(false)
  const [askPrint, setAskPrint] = useState(false)
  const labelRefs = useRef<HTMLElement[][]>([])
  const labelLock = useRef(false)
  const [askLabel, setAskLabel] = useState(false)
  const [inTem, setInTem] = useState<{ busy: boolean; message: string | null; error: boolean; needConfig?: boolean }>({
    busy: false,
    message: null,
    error: false,
  })
  const [png, setPng] = useState<Png | null>(null)
  const [pngError, setPngError] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [inNhiet, setInNhiet] = useState<{ busy: boolean; message: string | null; error: boolean; needConfig?: boolean }>({
    busy: false,
    message: null,
    error: false,
  })
  // Web Android: href `rawbt:` dựng SẴN trên `<a>` trước khi chạm (không `await` giữa chạm và điều
  // hướng — user gesture). `too-big` = qua guard cỡ URL; `failed` = lỗi chụp/nén.
  const [rawbt, setRawbt] = useState<{ status: 'idle' | 'building' | 'ready' | 'too-big' | 'failed'; href?: string }>({
    status: 'idle',
  })

  // Nội dung phiếu đổi thì ảnh cũ hết giá trị — dọn ngay trong lúc render, không đợi effect,
  // để không có nhịp nào nút "Chia sẻ" cầm ảnh của phiếu cũ.
  const [renderedFor, setRenderedFor] = useState<string | null>(null)
  if (signature !== renderedFor) {
    setRenderedFor(signature)
    setPng(null)
    setPngError(false)
    setRawbt({ status: 'idle' })
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

  // Dựng href RawBT SAU khi ảnh chia sẻ xong (chờ `png`/`pngError`) — không chạy hai lượt html-to-image
  // song song (cảnh báo ở effect trên). Chỉ web Android; native đi đường TCP, desktop/iOS `rawbt:` vô nghĩa.
  useEffect(() => {
    if (!isAndroidWeb()) return
    if (png === null && !pngError) return
    const node = thermalRef.current
    if (!node) return
    let cancelled = false
    setRawbt({ status: 'building' })
    void (async () => {
      try {
        const href = await buildReceiptRawbtHref(node)
        if (cancelled) return
        setRawbt(href ? { status: 'ready', href } : { status: 'too-big' })
      } catch {
        if (!cancelled) setRawbt({ status: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [png, pngError, signature])

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

  // Chụp LƯỜI khi chạm (D6): gọi plugin không phải điều hướng nên không cần href dựng sẵn. Bản nhiệt
  // một dải nằm sẵn trong DOM ẩn — chỉ chụp thành byte lúc bấm.
  const onPrintThermal = async () => {
    if (printLock.current) return
    const cfg = readPrinterConfig()
    if (!cfg) {
      setInNhiet({ busy: false, message: 'Chưa cài IP máy in.', error: true, needConfig: true })
      return
    }
    const node = thermalRef.current
    if (!node) return
    printLock.current = true
    setInNhiet({ busy: true, message: 'Đang chuẩn bị bản in…', error: false })
    try {
      const bytes = await buildReceiptJob(node)
      await nativeSink(bytes, cfg)
      setInNhiet({ busy: false, message: `Đã gửi tới máy in ${cfg.host}:${cfg.port}.`, error: false })
    } catch (error) {
      setInNhiet({
        busy: false,
        message: error instanceof Error ? error.message : 'Không gửi được bản in.',
        error: true,
      })
    } finally {
      printLock.current = false
    }
  }

  // Như onPrintThermal: đọc lại cấu hình lúc gửi, khoá ref chống bấm-đúp (bấm đúp = in gấp đôi số tem).
  const onPrintLabels = async (lines: readonly OrderLine[]) => {
    if (labelLock.current) return
    const cfg = readLabelPrinterConfig()
    if (!cfg) {
      setInTem({ busy: false, message: 'Chưa cài máy in tem.', error: true, needConfig: true })
      return
    }
    const copies = labelCopies(lines)
    const items = lines.flatMap((_, i) => {
      const nodes = labelRefs.current[i]
      return nodes?.length ? [{ nodes, copies: copies[i] ?? 0 }] : []
    })
    if (items.length !== lines.length) {
      setInTem({ busy: false, message: 'Chưa dựng xong tem — thử lại sau giây lát.', error: true })
      return
    }
    labelLock.current = true
    setInTem({ busy: true, message: 'Đang chuẩn bị tem…', error: false })
    try {
      // Logo là dữ liệu đồng bộ từ máy khác: hỏng thì vẫn in tem, chỉ bỏ hình chìm — đừng để nó khoá nút in trên mọi máy.
      let watermark: LabelWatermarkJob | null = null
      let logoNote = ''
      if (shop.logo && shop.labelWatermark.enabled) {
        try {
          watermark = { logo: await decodeLogo(shop.logo), config: shop.labelWatermark }
        } catch {
          logoNote = ' Logo không đọc được nên tem in không có logo — vào Thông tin cửa hàng chọn lại ảnh logo.'
        }
      }
      await nativeSink(await buildLabelJob(items, cfg, watermark), cfg)
      // Ghi chú dài ra thêm tem tiếp nên số tờ thật có thể nhiều hơn số ly; nói rõ để người bán không đếm lệch.
      const cups = copies.reduce((sum, n) => sum + n, 0)
      const sheets = items.reduce((sum, { nodes, copies }) => sum + nodes.length * copies, 0)
      const extra = sheets > cups ? ` (${sheets} tờ giấy, ${sheets - cups} tờ là phần ghi chú dài)` : ''
      setInTem({
        busy: false,
        message: `Đã gửi ${cups} tem${extra} tới máy in ${cfg.host}:${cfg.port}.${logoNote}`,
        error: false,
      })
    } catch (error) {
      setInTem({
        busy: false,
        message: error instanceof Error ? error.message : 'Không gửi được tem.',
        error: true,
      })
    } finally {
      labelLock.current = false
    }
  }

  const onDownloadBin = async () => {
    const node = thermalRef.current
    if (!node) return
    try {
      downloadBytes(await buildReceiptJob(node), `${order.code}.bin`)
    } catch {
      // Tiện ích chỉ có ở bản dev; nuốt lỗi chụp để không văng unhandled rejection lúc thử.
    }
  }

  const busy = png === null && !pngError
  // Mỗi nền tảng tối đa MỘT nút in: native → `<button data-tcp-print>` (TCP, pha 4); web Android →
  // `<a data-rawbt>` (RawBT); web khác → không nút. Bộ chọn khác nhau nên test không đếm nhầm.
  const native = isNativeApp()
  const androidWeb = isAndroidWeb()
  // IP để hiện trong hộp xác nhận; onPrintThermal vẫn đọc lại lúc gửi (nguồn sự thật).
  const printerCfg = native ? readPrinterConfig() : null
  // Tem chỉ đi TCP trong APK (RawBT không biết khe hở giữa hai tem). Đơn huỷ không ra ly nào để dán.
  const labels = labelCount(data.lines)
  const showLabels = native && order.status !== 'void' && labels > 0
  const labelCfg = showLabels ? readLabelPrinterConfig() : null

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

          {showLabels ? (
            <div className="no-print -mt-4 h-0 overflow-hidden" aria-hidden="true">
              {data.lines.map((line, index) => (
                <LabelSheet
                  key={line.id}
                  shop={shop}
                  order={order}
                  line={line}
                  size={labelCfg ?? DEFAULT_LABEL_SIZE}
                  count={labels}
                  onNodes={(nodes) => {
                    labelRefs.current[index] = nodes
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Bản nhiệt một dải cho máy in nhiệt: con CUỐI của .space-y-4, ẩn (bất biến #4). KHÔNG mang
              .receipt-view — các ca đếm tấm gửi khách bằng class đó. `-mt-4` triệt margin space-y-4 qua
              collapse (16 − 16 = 0); không đổi sang -mb-4. */}
          <div className="no-print -mt-4 h-0 overflow-hidden" aria-hidden="true">
            <ReceiptView {...data} lines={data.lines} thermal innerRef={thermalRef} />
          </div>
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

          {native ? (
            <Button
              size="cta"
              variant="secondary"
              data-tcp-print
              disabled={inNhiet.busy}
              onClick={() => setAskPrint(true)}
              className="mb-3"
            >
              {inNhiet.busy ? 'Đang chuẩn bị bản in…' : '🖨 IN MÁY IN NHIỆT'}
            </Button>
          ) : androidWeb ? (
            <div className="mb-3">
              {rawbt.status === 'ready' && rawbt.href ? (
                <>
                  {/* Nút mở hộp xác nhận; href `rawbt:` dựng sẵn nằm TRÊN nút "In" trong hộp — cú chạm
                      "In" là user gesture thật, không `await` giữa chạm và điều hướng. */}
                  <Button size="cta" variant="secondary" className="w-full" onClick={() => setAskPrint(true)}>
                    🖨 IN MÁY IN NHIỆT
                  </Button>
                  <p className="mt-1 text-center text-[12px] text-muted">
                    Cần app RawBT trên Android (bản miễn phí in thêm một dòng).
                  </p>
                </>
              ) : rawbt.status === 'too-big' ? (
                <p role="status" className="rounded-btn bg-warn-tint px-3 py-2 text-[13px] text-warn">
                  Phiếu quá dài cho RawBT — dùng 📤 CHIA SẺ hoặc app Android.
                </p>
              ) : rawbt.status === 'failed' ? (
                <p role="status" className="rounded-btn bg-danger-tint px-3 py-2 text-[13px] text-danger">
                  Máy này chưa tạo được bản in cho RawBT — dùng 📤 CHIA SẺ.
                </p>
              ) : (
                <Button size="cta" variant="secondary" disabled>
                  Đang chuẩn bị bản in…
                </Button>
              )}
            </div>
          ) : null}

          {showLabels ? (
            <Button
              size="cta"
              variant="secondary"
              data-label-print
              disabled={inTem.busy}
              onClick={() => setAskLabel(true)}
              className="mb-3"
            >
              {inTem.busy ? 'Đang chuẩn bị tem…' : `🏷 IN TEM (${labels} tem)`}
            </Button>
          ) : null}

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
            {import.meta.env.DEV ? (
              <Button variant="ghost" onClick={() => void onDownloadBin()}>
                ⬇ .bin
              </Button>
            ) : null}
          </div>

          {inNhiet.message ? (
            <p
              role="status"
              aria-live="polite"
              className={`mt-3 rounded-btn px-3 py-2 text-[13px] ${inNhiet.error ? 'bg-danger-tint text-danger' : 'text-muted'}`}
            >
              {inNhiet.message}
              {inNhiet.needConfig ? (
                <>
                  {' '}
                  <Link to="/them/cai-dat" className="font-semibold underline">
                    Vào Cài đặt › MÁY IN
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}

          {inTem.message ? (
            <p
              role="status"
              aria-live="polite"
              className={`mt-3 rounded-btn px-3 py-2 text-[13px] ${inTem.error ? 'bg-danger-tint text-danger' : 'text-muted'}`}
            >
              {inTem.message}
              {inTem.needConfig ? (
                <>
                  {' '}
                  <Link to="/them/cai-dat" className="font-semibold underline">
                    Vào Cài đặt › MÁY IN TEM
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}

          {askLabel && showLabels ? (
            <ConfirmDialog
              title={`In ${labels} tem cho đơn ${order.code}?`}
              message={
                (labelCfg
                  ? `Gửi ${labels} tem (${labelCfg.widthMm}×${labelCfg.heightMm} mm) tới máy in tem ${labelCfg.host}:${labelCfg.port}.`
                  : `Gửi ${labels} tem tới máy in tem.`) +
                // Đơn sỉ vài chục phần là chuyện thường; đã gửi thì cuộn tem chạy một mạch, không dừng giữa chừng được.
                (labels > MANY_LABELS ? ` Nhiều tem — kiểm lại số lượng trước khi in.` : '')
              }
              confirmLabel="In tem"
              confirmVariant="primary"
              onConfirm={() => {
                setAskLabel(false)
                void onPrintLabels(data.lines)
              }}
              onCancel={() => setAskLabel(false)}
            />
          ) : null}

          {/* Hỏi xác nhận trước khi in để chặn cú bấm nhầm (giấy in phí). Native → nút "In" gọi thẳng
              onPrintThermal (còn khoá chống bấm-đúp bên trong). Web Android → nút "In" là `<a data-rawbt>`
              để giữ user gesture khi mở RawBT. */}
          {askPrint && native ? (
            <ConfirmDialog
              title="In phiếu ra máy in nhiệt?"
              message={
                printerCfg
                  ? `Gửi phiếu tới máy in ${printerCfg.host}:${printerCfg.port}.`
                  : 'Gửi phiếu tới máy in nhiệt.'
              }
              confirmLabel="In"
              confirmVariant="primary"
              onConfirm={() => {
                setAskPrint(false)
                void onPrintThermal()
              }}
              onCancel={() => setAskPrint(false)}
            />
          ) : askPrint && androidWeb && rawbt.status === 'ready' && rawbt.href ? (
            <ConfirmDialog
              title="In phiếu ra máy in nhiệt?"
              message="Phiếu sẽ mở trong app RawBT để in."
              confirmLabel="In"
              confirmVariant="primary"
              confirmHref={rawbt.href}
              onConfirm={() => setAskPrint(false)}
              onCancel={() => setAskPrint(false)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
