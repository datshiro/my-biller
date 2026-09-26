import type { LabelSize } from '@/domain/tspl/encode'
import { parsePrinterConfig, type PrinterConfig } from './printer-config'

/** Máy in tem là một máy riêng (XPrinter), khác máy in phiếu — khoá riêng để tem không chạy nhầm sang SPR02. */
export type LabelPrinterConfig = PrinterConfig & LabelSize

export const LABEL_PRINTER_CONFIG_KEY = 'may-in-tem'
/** Cuộn tem đang lắp ở quán: 50×30 mm, khe 2 mm — đã in đúng trên XP-365B thật. */
export const DEFAULT_LABEL_SIZE: LabelSize = { widthMm: 50, heightMm: 30, gapMm: 2 }

type Raw = { host: string; port: string; widthMm: string; heightMm: string; gapMm: string }
type ParseResult = { ok: true; value: LabelPrinterConfig } | { ok: false; error: string }

/** XP-365B in được vùng rộng tối đa 72 mm (giấy 80 mm). Số nguyên mm để khổ × 8 chấm luôn tròn. */
function parseMm(raw: string, min: number, max: number): number | null {
  const text = raw.trim()
  if (!/^\d{1,3}$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

export function parseLabelPrinterConfig(raw: Raw): ParseResult {
  const printer = parsePrinterConfig(raw.host, raw.port)
  if (!printer.ok) return printer
  // Nhỏ hơn 30×25 mm thì tên món, ghi chú, tên khách và số thứ tự `i/n` không còn đủ chỗ mà không đè nhau.
  const widthMm = parseMm(raw.widthMm, 30, 72)
  if (widthMm === null) return { ok: false, error: 'Chiều rộng tem phải là số mm từ 30 đến 72.' }
  const heightMm = parseMm(raw.heightMm, 25, 100)
  if (heightMm === null) return { ok: false, error: 'Chiều cao tem phải là số mm từ 25 đến 100.' }
  const gapMm = parseMm(raw.gapMm, 0, 10)
  if (gapMm === null) return { ok: false, error: 'Khe hở giữa hai tem phải là số mm từ 0 đến 10.' }
  return { ok: true, value: { ...printer.value, widthMm, heightMm, gapMm } }
}

/** Khoá rác hoặc thiếu trường → `null`, xử như chưa cài: đừng gửi tem với khổ đoán mò. */
export function readLabelPrinterConfig(): LabelPrinterConfig | null {
  try {
    const stored = localStorage.getItem(LABEL_PRINTER_CONFIG_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { host, port, widthMm, heightMm, gapMm } = parsed as Record<string, unknown>
    if ([port, widthMm, heightMm, gapMm].some((n) => typeof n !== 'number') || typeof host !== 'string') return null
    const check = parseLabelPrinterConfig({
      host,
      port: String(port),
      widthMm: String(widthMm),
      heightMm: String(heightMm),
      gapMm: String(gapMm),
    })
    return check.ok ? check.value : null
  } catch {
    return null
  }
}

export function saveLabelPrinterConfig(cfg: LabelPrinterConfig): void {
  localStorage.setItem(LABEL_PRINTER_CONFIG_KEY, JSON.stringify(cfg))
}
