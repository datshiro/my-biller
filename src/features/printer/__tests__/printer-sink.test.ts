import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrinterConfig } from '../printer-config'

// `registerPlugin` chạy lúc nạp module → mock phải trả một object ổn định mà ca test điều khiển được.
const cap = vi.hoisted(() => ({
  printRaw: vi.fn<(o: { host: string; port: number; base64: string; timeoutMs: number }) => Promise<{ sent: number }>>(),
  native: true,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native },
  registerPlugin: () => ({ printRaw: cap.printRaw }),
}))

import { isNativeApp, nativeSink } from '../printer-sink'

const CFG: PrinterConfig = { host: '192.168.1.50', port: 9100 }

afterEach(() => {
  cap.printRaw.mockReset()
  cap.native = true
})

describe('nativeSink', () => {
  it('gọi PrinterSocket.printRaw với host/port/base64/timeout 3000', async () => {
    cap.printRaw.mockResolvedValue({ sent: 3 })
    await nativeSink(new Uint8Array([1, 2, 3]), CFG)
    // btoa của byte [1,2,3] = "AQID"
    expect(cap.printRaw).toHaveBeenCalledWith({ host: '192.168.1.50', port: 9100, base64: 'AQID', timeoutMs: 3000 })
  })

  it.each([
    ['ETIMEDOUT', 'Máy in không trả lời sau 3 giây.'],
    ['ECONNREFUSED', 'Máy in từ chối kết nối ở cổng 9100.'],
    ['EHOSTUNREACH', 'Không nối được máy in 192.168.1.50:9100 — kiểm tra máy in đã bật và cùng WiFi.'],
    ['EOTHER', 'Không nối được máy in 192.168.1.50:9100 — kiểm tra máy in đã bật và cùng WiFi.'],
  ])('mã lỗi %s → câu tiếng Việt cho người bán', async (code, message) => {
    cap.printRaw.mockRejectedValue(Object.assign(new Error('native'), { code }))
    await expect(nativeSink(new Uint8Array([1]), CFG)).rejects.toThrow(message)
  })
})

describe('isNativeApp', () => {
  it('theo Capacitor.isNativePlatform()', () => {
    cap.native = true
    expect(isNativeApp()).toBe(true)
    cap.native = false
    expect(isNativeApp()).toBe(false)
  })
})
