import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { buildSampleJob } from '../printer/print-job'
import {
  DEFAULT_PORT,
  parsePrinterConfig,
  readPrinterConfig,
  savePrinterConfig,
  type PrinterConfig,
} from '../printer/printer-config'
import { isAndroidWeb, isNativeApp, nativeSink } from '../printer/printer-sink'
import { buildSampleRawbtHref } from '../printer/rawbt-href'
import { SampleSheet } from '../printer/sample-sheet'
import { RAWBT_PLAY_URL } from '@/domain/rawbt-url'
import { Button } from '@/ui/button'
import { buttonClassName } from '@/ui/button-class'

type State =
  | { kind: 'idle' }
  | { kind: 'saved'; cfg: PrinterConfig }
  | { kind: 'invalid'; message: string }
  | { kind: 'printing' }
  | { kind: 'sent'; cfg: PrinterConfig }
  | { kind: 'failed'; message: string }

const INPUT = 'mt-1 h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand'

/**
 * Mục MÁY IN trong Cài đặt: nhập IP/cổng máy in nhiệt (đường TCP, chỉ dùng được trong APK). Khối IP hiện
 * ở mọi nền tảng để Robot lái được (D5); IN THỬ chỉ bật khi chạy native + cấu hình hợp lệ. Theo mẫu
 * `app-update-section.tsx`: một máy trạng thái, nhãn/ghi chú theo trạng thái, vùng aria-live.
 */
export function PrinterSection() {
  const existing = useMemo(() => readPrinterConfig(), [])
  const [host, setHost] = useState(existing?.host ?? '')
  const [port, setPort] = useState(String(existing?.port ?? DEFAULT_PORT))
  const [state, setState] = useState<State>(existing ? { kind: 'saved', cfg: existing } : { kind: 'idle' })
  const sampleRef = useRef<HTMLDivElement | null>(null)
  // Khoá đồng bộ chống bấm-đúp: `disabled` theo state chỉ khoá sau render lại, hai chạm cùng nhịp lọt cả
  // hai → hai tờ mẫu (như nút in phiếu trên SPR02 thật). Ref chặn cú thứ hai ngay.
  const testLock = useRef(false)
  const ipId = useId()
  const portId = useId()
  const native = isNativeApp()
  const androidWeb = isAndroidWeb()
  const cfgValid = parsePrinterConfig(host, port).ok

  // Web Android: dựng SẴN href tờ mẫu RawBT lúc mount (bitmap 576×~200 → PNG vài KB). Native/desktop bỏ qua.
  // `failed` tách khỏi `building` để lỗi (WebView cũ thiếu CompressionStream) không kẹt mãi ở "Đang chuẩn
  // bị" — như dòng lỗi RawBT ở màn phiếu.
  const [rawbtSample, setRawbtSample] = useState<{ status: 'building' | 'ready' | 'failed'; href?: string }>({
    status: 'building',
  })
  useEffect(() => {
    if (!androidWeb) return
    const node = sampleRef.current
    if (!node) return
    let cancelled = false
    void (async () => {
      try {
        const href = await buildSampleRawbtHref(node)
        if (!cancelled) setRawbtSample({ status: 'ready', href })
      } catch {
        if (!cancelled) setRawbtSample({ status: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [androidWeb])

  // Gõ lại thì thông báo "Đã lưu"/"Đã gửi"/lỗi cũ hết đúng — về idle để không khẳng định một giá trị
  // chưa lưu. Giữ nguyên khi đang in. Trả `prev` khi đã idle để React bỏ qua render thừa.
  const clearNotice = () =>
    setState((prev) => (prev.kind === 'idle' || prev.kind === 'printing' ? prev : { kind: 'idle' }))
  const onChangeHost = (value: string) => {
    setHost(value)
    clearNotice()
  }
  const onChangePort = (value: string) => {
    setPort(value)
    clearNotice()
  }

  const onSave = () => {
    const parsed = parsePrinterConfig(host, port)
    if (!parsed.ok) {
      setState({ kind: 'invalid', message: parsed.error })
      return
    }
    savePrinterConfig(parsed.value)
    setHost(parsed.value.host)
    setPort(String(parsed.value.port))
    setState({ kind: 'saved', cfg: parsed.value })
  }

  // Một chạm = lưu + gửi tờ mẫu. Đọc THẲNG ô nhập (không đọc kho) nên đích gửi và thông điệp không lệch
  // nhau: gửi tới đúng IP đang hiện, và báo đúng IP đó.
  const onTest = async () => {
    if (testLock.current) return
    const parsed = parsePrinterConfig(host, port)
    if (!parsed.ok) {
      setState({ kind: 'invalid', message: parsed.error })
      return
    }
    const node = sampleRef.current
    if (!node) return
    testLock.current = true
    savePrinterConfig(parsed.value)
    setState({ kind: 'printing' })
    try {
      await nativeSink(await buildSampleJob(node), parsed.value)
      setState({ kind: 'sent', cfg: parsed.value })
    } catch (error) {
      // Giữ nguyên câu lỗi thật: chốt chặn 576 chấm (D14) và câu map lỗi TCP của lớp sink (pha 4) đều
      // đi qua đây — nuốt hết thành "kiểm tra WiFi" thì mọi lỗi đọc như nhau, dev debug nhầm tầng.
      setState({
        kind: 'failed',
        message:
          error instanceof Error && error.message
            ? error.message
            : `Không nối được máy in ${parsed.value.host}:${parsed.value.port} — kiểm tra máy in đã bật và cùng WiFi.`,
      })
    } finally {
      testLock.current = false
    }
  }

  const saved = state.kind === 'saved' ? `Đã lưu ${state.cfg.host}:${state.cfg.port}` : null
  const sent = state.kind === 'sent' ? `Đã gửi tờ mẫu tới ${state.cfg.host}:${state.cfg.port}` : null

  return (
    <>
      {/* Web Android: khối IN QUA RAWBT đặt TRÊN khối IP — đường web không cấu hình gì (IP nằm trong RawBT). */}
      {androidWeb ? (
        <div className="mb-4 rounded-btn border border-line bg-surface px-3 py-3">
          <p className="text-[13px] font-semibold">IN QUA RAWBT</p>
          <p className="mt-1 text-[13px] text-muted">
            Trên web, phiếu in qua ứng dụng RawBT; địa chỉ máy in cài trong RawBT (WiFi › IP máy in, cổng 9100).
          </p>
          <a
            href={RAWBT_PLAY_URL}
            target="_blank"
            rel="noopener"
            className="mt-1 inline-block text-[13px] font-semibold text-brand underline"
          >
            Cài RawBT
          </a>
          {rawbtSample.status === 'ready' && rawbtSample.href ? (
            <a data-rawbt href={rawbtSample.href} className={buttonClassName('secondary', 'cta', 'mt-3')}>
              IN THỬ QUA RAWBT
            </a>
          ) : rawbtSample.status === 'failed' ? (
            <p role="status" className="mt-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] text-danger">
              Máy này chưa tạo được tờ mẫu cho RawBT — dùng 📤 CHIA SẺ.
            </p>
          ) : (
            <Button size="cta" variant="secondary" className="mt-3" disabled>
              Đang chuẩn bị tờ mẫu…
            </Button>
          )}
        </div>
      ) : null}

      {/* Nhãn và ô là hai phần tử anh em (không lồng nhau): `Ô Theo Nhãn` của Robot bám
          `//label[...]/following::input[1]`, và `htmlFor` nối để màn đọc/`getByLabelText` khớp. */}
      <label htmlFor={ipId} className="block text-[13px] font-semibold text-muted">
        Địa chỉ IP máy in
      </label>
      <input
        id={ipId}
        value={host}
        onChange={(event) => onChangeHost(event.target.value)}
        inputMode="decimal"
        placeholder="192.168.1.50"
        className={INPUT}
      />
      <label htmlFor={portId} className="mt-3 block text-[13px] font-semibold text-muted">
        Cổng
      </label>
      <input
        id={portId}
        value={port}
        onChange={(event) => onChangePort(event.target.value)}
        inputMode="numeric"
        placeholder={String(DEFAULT_PORT)}
        className={INPUT}
      />

      {state.kind === 'invalid' ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onSave}>
          LƯU
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={!native || !cfgValid || state.kind === 'printing'}
          onClick={() => void onTest()}
        >
          {state.kind === 'printing' ? 'Đang gửi…' : 'IN THỬ'}
        </Button>
      </div>

      {/* Ghi chú cố định trên web: giải thích vì sao IN THỬ khoá. Robot bám tiền TỐ "Chỉ in được trong
          app Android" (không đổi); phần đuôi dẫn tới khối RawBT ở trên khi web Android, còn desktop/iOS
          (không mở được `rawbt:`) dẫn về 📤 CHIA SẺ. */}
      {!native ? (
        <p className="mt-2 text-[13px] text-muted">
          Chỉ in được trong app Android cài từ file APK.{' '}
          {androidWeb ? 'Trên web dùng khối IN QUA RAWBT ở trên.' : 'Trên web dùng 📤 CHIA SẺ.'}
        </p>
      ) : null}

      {/* Vùng live có sẵn để màn đọc bắt được khi chữ đổi. */}
      <p aria-live="polite" className={saved || sent ? 'mt-2 text-[13px] font-semibold text-brand' : 'sr-only'}>
        {saved ?? sent ?? ''}
      </p>
      {state.kind === 'failed' ? (
        <p role="alert" className="mt-2 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      {/* Tờ IN THỬ ẩn (D14): phần chữ chụp lười khi bấm IN THỬ. KHÔNG mang .receipt-view. Node rộng 360px
          trên màn 320px sẽ bị bộ dò tràn ngang (layout.spec) bắt — bọc trong khung `overflow-x-auto`
          (bộ dò tha con cháu của khung đó), đúng cấu trúc màn phiếu; khung ngoài không thực sự cuộn vì
          con duy nhất là `h-0` rộng auto. */}
      <div className="no-print overflow-x-auto" aria-hidden="true">
        <div className="h-0 overflow-hidden">
          <SampleSheet innerRef={sampleRef} />
        </div>
      </div>
    </>
  )
}
