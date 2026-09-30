import { Capacitor, registerPlugin } from '@capacitor/core'
import { toBase64 } from '@/domain/base64'
import type { PrinterConfig } from './printer-config'

type PrinterSocketPlugin = {
  printRaw(options: {
    host: string
    port: number
    base64: string
    timeoutMs: number
    writeTimeoutMs: number
  }): Promise<{ sent: number }>
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

/** Gốc 20 giây cho máy in nhả giấy/tem, cộng 1 giây mỗi 10 KB job. */
export function jobTimeoutMs(bytes: Uint8Array): number {
  return 20_000 + Math.ceil(bytes.length / 10)
}

/**
 * Mỗi máy in nhận một nối TCP một lúc, nên mọi job tới cùng `host:port` (in phiếu, IN THỬ, in tem, job nhận
 * qua Bluetooth) xếp một hàng; máy in phiếu và máy in tem khác địa chỉ thì hai hàng chạy song song. Mỗi job
 * có hạn riêng — quá hạn thì job đó báo lỗi và hàng đi tiếp, thay vì mọi phiếu sau kẹt im lặng.
 */
export function serialSink(
  send: PrinterSink,
  timeoutFor: (bytes: Uint8Array) => number = jobTimeoutMs,
): PrinterSink {
  const tails = new Map<string, Promise<unknown>>()
  return (bytes, cfg) => {
    const key = `${cfg.host}:${cfg.port}`
    const run = (tails.get(key) ?? Promise.resolve()).then(() => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Máy in nhận job quá lâu mà không xong — kiểm tra giấy/tem rồi in lại.')),
          timeoutFor(bytes),
        )
      })
      return Promise.race([send(bytes, cfg), expired]).finally(() => clearTimeout(timer))
    })
    const tail = run.catch(() => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}

/**
 * Gửi job tới máy in qua plugin `PrinterSocket` (chỉ chạy trong APK — trên web nút TCP không render).
 * Mã lỗi của plugin đổi thành câu tiếng Việt cho người bán; RST-sau-khi-gửi đã được plugin coi là
 * "đã gửi" nên tới đây chỉ còn lỗi nối/timeout thật.
 */
const sendRaw: PrinterSink = async (bytes, cfg) => {
  try {
    await PrinterSocket.printRaw({
      host: cfg.host,
      port: cfg.port,
      base64: toBase64(bytes),
      timeoutMs: TCP_TIMEOUT_MS,
      writeTimeoutMs: jobTimeoutMs(bytes),
    })
  } catch (caught) {
    throw new Error(printerErrorMessage(caught, cfg), { cause: caught })
  }
}

// Hạn ghi của plugin chỉ bắt đầu sau khi nối xong (tới TCP_TIMEOUT_MS), nên hàng chờ thêm cả hạn nối lẫn
// 2 giây dư: plugin luôn cắt job trước, hàng không mở nối thứ hai khi job cũ còn đang ghi.
const PLUGIN_MARGIN_MS = TCP_TIMEOUT_MS + 2_000
export const nativeSink: PrinterSink = serialSink(sendRaw, (bytes) => jobTimeoutMs(bytes) + PLUGIN_MARGIN_MS)

function printerErrorMessage(caught: unknown, cfg: PrinterConfig): string {
  const code = (caught as { code?: unknown }).code
  switch (code) {
    case 'ETIMEDOUT':
      return 'Máy in không trả lời sau 3 giây.'
    case 'EWRITETIMEOUT':
      return 'Máy in ngừng nhận giữa chừng — kiểm tra giấy/tem, khe hở rồi in lại.'
    case 'ECONNREFUSED':
      return `Máy in từ chối kết nối ở cổng ${cfg.port}.`
    default:
      return `Không nối được máy in ${cfg.host}:${cfg.port} — kiểm tra máy in đã bật và cùng WiFi.`
  }
}
