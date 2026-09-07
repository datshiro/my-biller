import { useId, useMemo, useRef, useState } from 'react'
import { buildSampleJob } from '../printer/print-job'
import {
  DEFAULT_PORT,
  parsePrinterConfig,
  readPrinterConfig,
  savePrinterConfig,
  type PrinterConfig,
} from '../printer/printer-config'
import { isNativeApp, nativeSink } from '../printer/printer-sink'
import { SampleSheet } from '../printer/sample-sheet'
import { Button } from '@/ui/button'

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
  const ipId = useId()
  const portId = useId()
  const native = isNativeApp()
  const cfgValid = parsePrinterConfig(host, port).ok

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
    const parsed = parsePrinterConfig(host, port)
    if (!parsed.ok) {
      setState({ kind: 'invalid', message: parsed.error })
      return
    }
    const node = sampleRef.current
    if (!node) return
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
    }
  }

  const saved = state.kind === 'saved' ? `Đã lưu ${state.cfg.host}:${state.cfg.port}` : null
  const sent = state.kind === 'sent' ? `Đã gửi tờ mẫu tới ${state.cfg.host}:${state.cfg.port}` : null

  return (
    <>
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

      {/* Ghi chú cố định trên web: giải thích vì sao IN THỬ khoá. Robot bám tiền tố câu này. */}
      {!native ? (
        <p className="mt-2 text-[13px] text-muted">
          Chỉ in được trong app Android cài từ file APK. Trên web dùng 📤 CHIA SẺ.
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
