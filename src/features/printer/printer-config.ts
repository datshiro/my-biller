export type PrinterConfig = { host: string; port: number }

export const PRINTER_CONFIG_KEY = 'may-in'
export const DEFAULT_PORT = 9100

type ParseResult = { ok: true; value: PrinterConfig } | { ok: false; error: string }

/** Chỉ số và dấu chấm → người dùng đang gõ IPv4, phải đủ 4 nhóm 0–255; chữ cái → coi là hostname. */
const LOOKS_NUMERIC = /^[\d.]+$/
/** Nhãn hostname RFC-1123: chữ/số/gạch nối, không mở/đóng bằng gạch nối. Chặn `:9100`, `http://`, dấu cách. */
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/

function validHost(host: string): boolean {
  if (LOOKS_NUMERIC.test(host)) {
    const parts = host.split('.')
    if (parts.length !== 4) return false
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  }
  return HOSTNAME.test(host)
}

/**
 * Đọc IP và cổng người bán gõ. Không tự sửa: sai định dạng thì trả lỗi để màn hiện dòng đỏ và KHÔNG
 * lưu — cấu hình máy in sai còn tệ hơn không có, vì bấm IN THỬ sẽ treo chờ một IP không tồn tại.
 */
export function parsePrinterConfig(hostRaw: string, portRaw: string): ParseResult {
  const host = hostRaw.trim()
  if (!host) return { ok: false, error: 'Nhập địa chỉ IP máy in.' }
  if (/\s/.test(host)) return { ok: false, error: 'Địa chỉ không được có khoảng trắng.' }
  if (!validHost(host)) return { ok: false, error: 'Địa chỉ IP không hợp lệ (ví dụ 192.168.1.50).' }

  const portStr = portRaw.trim()
  // Chỉ chữ số (không `0x10`, `1e3`, số âm); trống → cổng mặc định.
  if (portStr !== '' && !/^\d{1,5}$/.test(portStr)) {
    return { ok: false, error: 'Cổng phải là số từ 1 đến 65535.' }
  }
  const port = portStr === '' ? DEFAULT_PORT : Number(portStr)
  if (port < 1 || port > 65535) {
    return { ok: false, error: 'Cổng phải là số từ 1 đến 65535.' }
  }

  return { ok: true, value: { host, port } }
}

/** JSON hỏng hoặc thiếu trường → `null`: xử như chưa cấu hình, không để một khoá rác làm treo IN THỬ. */
export function readPrinterConfig(): PrinterConfig | null {
  try {
    const raw = localStorage.getItem(PRINTER_CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { host, port } = parsed as Record<string, unknown>
    if (typeof host !== 'string' || typeof port !== 'number') return null
    const check = parsePrinterConfig(host, String(port))
    return check.ok ? check.value : null
  } catch {
    return null
  }
}

export function savePrinterConfig(cfg: PrinterConfig): void {
  localStorage.setItem(PRINTER_CONFIG_KEY, JSON.stringify(cfg))
}
