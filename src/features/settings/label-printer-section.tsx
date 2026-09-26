import { useId, useMemo, useState } from 'react'
import {
  DEFAULT_LABEL_SIZE,
  parseLabelPrinterConfig,
  readLabelPrinterConfig,
  saveLabelPrinterConfig,
  type LabelPrinterConfig,
} from '../printer/label-config'
import { DEFAULT_PORT } from '../printer/printer-config'
import { isNativeApp } from '../printer/printer-sink'
import { Button } from '@/ui/button'

type State = { kind: 'idle' } | { kind: 'saved'; cfg: LabelPrinterConfig } | { kind: 'invalid'; message: string }

const INPUT = 'mt-1 h-12 w-full rounded-btn border border-line bg-surface px-3 text-[17px] outline-none focus:border-brand'
const LABEL = 'block text-[13px] font-semibold text-muted'

/**
 * Mục MÁY IN TEM: máy in tem (XPrinter) có IP riêng và khổ tem riêng. Hiện ở mọi nền tảng để Robot lái
 * được như mục MÁY IN; nút IN TEM trên phiếu chỉ có trong APK.
 */
export function LabelPrinterSection() {
  const existing = useMemo(() => readLabelPrinterConfig(), [])
  const [fields, setFields] = useState({
    host: existing?.host ?? '',
    port: String(existing?.port ?? DEFAULT_PORT),
    widthMm: String(existing?.widthMm ?? DEFAULT_LABEL_SIZE.widthMm),
    heightMm: String(existing?.heightMm ?? DEFAULT_LABEL_SIZE.heightMm),
    gapMm: String(existing?.gapMm ?? DEFAULT_LABEL_SIZE.gapMm),
  })
  const [state, setState] = useState<State>(existing ? { kind: 'saved', cfg: existing } : { kind: 'idle' })
  const id = useId()

  // Gõ lại thì "Đã lưu" cũ hết đúng — về idle để không khẳng định một giá trị chưa lưu.
  const onChange = (key: keyof typeof fields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
    setState((prev) => (prev.kind === 'idle' ? prev : { kind: 'idle' }))
  }

  const onSave = () => {
    const parsed = parseLabelPrinterConfig(fields)
    if (!parsed.ok) {
      setState({ kind: 'invalid', message: parsed.error })
      return
    }
    const cfg = parsed.value
    saveLabelPrinterConfig(cfg)
    setFields({
      host: cfg.host,
      port: String(cfg.port),
      widthMm: String(cfg.widthMm),
      heightMm: String(cfg.heightMm),
      gapMm: String(cfg.gapMm),
    })
    setState({ kind: 'saved', cfg })
  }

  // Nhãn và ô là anh em (không lồng): `Ô Theo Nhãn` của Robot bám `//label[...]/following::input[1]`.
  const field = (key: keyof typeof fields, label: string, placeholder: string, inputMode: 'decimal' | 'numeric') => (
    <div className="mt-3 first:mt-0">
      <label htmlFor={`${id}-${key}`} className={LABEL}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={fields[key]}
        onChange={(event) => onChange(key, event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className={INPUT}
      />
    </div>
  )

  const saved =
    state.kind === 'saved'
      ? `Đã lưu ${state.cfg.host}:${state.cfg.port} · tem ${state.cfg.widthMm}×${state.cfg.heightMm} mm`
      : null

  return (
    <>
      {field('host', 'Địa chỉ IP máy in tem', '192.168.1.60', 'decimal')}
      {field('port', 'Cổng máy in tem', String(DEFAULT_PORT), 'numeric')}
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">{field('widthMm', 'Rộng tem (mm)', String(DEFAULT_LABEL_SIZE.widthMm), 'numeric')}</div>
        <div className="min-w-0 flex-1">{field('heightMm', 'Cao tem (mm)', String(DEFAULT_LABEL_SIZE.heightMm), 'numeric')}</div>
        <div className="min-w-0 flex-1">{field('gapMm', 'Khe hở (mm)', String(DEFAULT_LABEL_SIZE.gapMm), 'numeric')}</div>
      </div>

      {state.kind === 'invalid' ? (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">
          {state.message}
        </p>
      ) : null}

      <Button variant="secondary" className="mt-3 w-full" onClick={onSave}>
        LƯU MÁY IN TEM
      </Button>

      {!isNativeApp() ? (
        <p className="mt-2 text-[13px] text-muted">In tem chỉ có trong app Android cài từ file APK.</p>
      ) : null}

      <p aria-live="polite" className={saved ? 'mt-2 text-[13px] font-semibold text-brand' : 'sr-only'}>
        {saved ?? ''}
      </p>
    </>
  )
}
