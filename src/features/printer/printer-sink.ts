import { Capacitor, registerPlugin } from '@capacitor/core'
import { toBase64 } from '@/domain/base64'
import type { PrinterConfig } from './printer-config'

type PrinterSocketPlugin = {
  printRaw(options: { host: string; port: number; base64: string; timeoutMs: number }): Promise<{ sent: number }>
}

const PrinterSocket = registerPlugin<PrinterSocketPlugin>('PrinterSocket')

/** Đẩy byte tới máy in. Một hiện thực: `nativeSink` (plugin TCP). Đường web (RawBT) không qua sink. */
export type PrinterSink = (bytes: Uint8Array, cfg: PrinterConfig) => Promise<void>

/** Đang chạy trong vỏ native (APK) hay không. Capacitor trả `false` trên web nên nút TCP không render. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Web trên Android (không phải vỏ native): `rawbt:` mở được vì có app RawBT trên máy. Chrome, Samsung
 * Internet, Firefox Android đều để "Android" trong UA. Desktop/iOS → false: `rawbt:` vô nghĩa, không hiện
 * nút/khối RawBT. Dò UA thô là đủ (D13); Chrome desktop "Request mobile site" giả UA là mép đã chấp nhận.
 */
export function isAndroidWeb(): boolean {
  return !isNativeApp() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

const TCP_TIMEOUT_MS = 3000

/**
 * Gửi job tới máy in qua plugin `PrinterSocket` (chỉ chạy trong APK — trên web nút TCP không render).
 * Mã lỗi của plugin đổi thành câu tiếng Việt cho người bán; RST-sau-khi-gửi đã được plugin coi là
 * "đã gửi" nên tới đây chỉ còn lỗi nối/timeout thật.
 */
export const nativeSink: PrinterSink = async (bytes, cfg) => {
  try {
    await PrinterSocket.printRaw({
      host: cfg.host,
      port: cfg.port,
      base64: toBase64(bytes),
      timeoutMs: TCP_TIMEOUT_MS,
    })
  } catch (caught) {
    throw new Error(printerErrorMessage(caught, cfg), { cause: caught })
  }
}

function printerErrorMessage(caught: unknown, cfg: PrinterConfig): string {
  const code = (caught as { code?: unknown }).code
  switch (code) {
    case 'ETIMEDOUT':
      return 'Máy in không trả lời sau 3 giây.'
    case 'ECONNREFUSED':
      return `Máy in từ chối kết nối ở cổng ${cfg.port}.`
    default:
      return `Không nối được máy in ${cfg.host}:${cfg.port} — kiểm tra máy in đã bật và cùng WiFi.`
  }
}
