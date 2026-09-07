import type { PrinterConfig } from './printer-config'

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
}

/** Đẩy byte tới máy in. Một hiện thực: `nativeSink` (plugin TCP, pha 4). Đường web không qua sink. */
export type PrinterSink = (bytes: Uint8Array, cfg: PrinterConfig) => Promise<void>

/**
 * Đang chạy trong vỏ native (APK) hay không. Pha 2 đọc cờ Capacitor gắn trên `window` mà không thêm
 * dependency; pha 4 đổi sang `Capacitor.isNativePlatform()` khi đã cài `@capacitor/core`.
 */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
}

/**
 * Web trên Android (không phải vỏ native): `rawbt:` mở được vì có app RawBT trên máy. Chrome, Samsung
 * Internet, Firefox Android đều để "Android" trong UA. Desktop/iOS → false: `rawbt:` vô nghĩa, không hiện
 * nút/khối RawBT. Dò UA thô là đủ (D13); Chrome desktop "Request mobile site" giả UA là mép đã chấp nhận.
 */
export function isAndroidWeb(): boolean {
  return !isNativeApp() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/**
 * Pha 2: chưa có plugin TCP nên ném lỗi có chữ "APK" — trên web nút TCP không render nên hàm này chỉ
 * chạy khi ai đó gọi thẳng. Pha 4 thay thân hàm bằng `PrinterSocket.printRaw`.
 */
export const nativeSink: PrinterSink = async () => {
  throw new Error('Chỉ in được trong app Android cài từ file APK.')
}
