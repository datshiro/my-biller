import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrinterConfig } from '../printer-config'

// `registerPlugin` chạy lúc nạp module → mock phải trả một object ổn định mà ca test điều khiển được.
const cap = vi.hoisted(() => ({
  printRaw: vi.fn<
    (o: { host: string; port: number; base64: string; timeoutMs: number; writeTimeoutMs: number }) => Promise<{ sent: number }>
  >(),
  native: true,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => cap.native },
  registerPlugin: () => ({ printRaw: cap.printRaw }),
}))

import { isNativeApp, jobTimeoutMs, nativeSink, serialSink } from '../printer-sink'

const CFG: PrinterConfig = { host: '192.168.1.50', port: 9100 }

afterEach(() => {
  cap.printRaw.mockReset()
  cap.native = true
})

describe('nativeSink', () => {
  it('gọi PrinterSocket.printRaw với host/port/base64/timeout 3000 và hạn ghi theo cỡ job', async () => {
    cap.printRaw.mockResolvedValue({ sent: 3 })
    await nativeSink(new Uint8Array([1, 2, 3]), CFG)
    // btoa của byte [1,2,3] = "AQID"
    expect(cap.printRaw).toHaveBeenCalledWith({
      host: '192.168.1.50',
      port: 9100,
      base64: 'AQID',
      timeoutMs: 3000,
      writeTimeoutMs: 20_001,
    })
  })

  it.each([
    ['ETIMEDOUT', 'Máy in không trả lời sau 3 giây.'],
    ['ECONNREFUSED', 'Máy in từ chối kết nối ở cổng 9100.'],
    ['EWRITETIMEOUT', 'Máy in ngừng nhận giữa chừng — kiểm tra giấy/tem, khe hở rồi in lại.'],
    ['EHOSTUNREACH', 'Không nối được máy in 192.168.1.50:9100 — kiểm tra máy in đã bật và cùng WiFi.'],
    ['EOTHER', 'Không nối được máy in 192.168.1.50:9100 — kiểm tra máy in đã bật và cùng WiFi.'],
  ])('mã lỗi %s → câu tiếng Việt cho người bán', async (code, message) => {
    cap.printRaw.mockRejectedValue(Object.assign(new Error('native'), { code }))
    await expect(nativeSink(new Uint8Array([1]), CFG)).rejects.toThrow(message)
  })
})

describe('serialSink', () => {
  afterEach(() => vi.useRealTimers())

  const deferred = () => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('job sau chỉ bắt đầu khi job trước xong, kể cả khi job trước lỗi', async () => {
    const first = deferred()
    const second = deferred()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const sink = serialSink(send)

    const a = sink(new Uint8Array([1]), CFG)
    const b = sink(new Uint8Array([2]), CFG)
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)

    first.reject(new Error('In hỏng'))
    await expect(a).rejects.toThrow('In hỏng')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    second.resolve()
    await expect(b).resolves.toBeUndefined()
  })

  it('job treo quá hạn thì báo lỗi và hàng đi tiếp', async () => {
    vi.useFakeTimers()
    const send = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(undefined)
    const sink = serialSink(send, () => 5_000)

    const hung = sink(new Uint8Array([1]), CFG)
    const next = sink(new Uint8Array([2]), CFG)
    const hungResult = expect(hung).rejects.toThrow('quá lâu')
    await vi.advanceTimersByTimeAsync(5_000)
    await hungResult
    await expect(next).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('nativeSink đi qua hàng chung: hai cú gọi chồng nhau không mở hai nối cùng lúc', async () => {
    const first = deferred()
    cap.printRaw.mockReturnValueOnce(first.promise.then(() => ({ sent: 1 }))).mockResolvedValueOnce({ sent: 1 })

    const a = nativeSink(new Uint8Array([1]), CFG)
    const b = nativeSink(new Uint8Array([2]), CFG)
    await Promise.resolve()
    expect(cap.printRaw).toHaveBeenCalledTimes(1)
    first.resolve()
    await Promise.all([a, b])
    expect(cap.printRaw).toHaveBeenCalledTimes(2)
  })

  it('hai máy in khác địa chỉ không chờ nhau', async () => {
    const receipt = deferred()
    const send = vi.fn().mockReturnValueOnce(receipt.promise).mockResolvedValueOnce(undefined)
    const sink = serialSink(send)

    const slow = sink(new Uint8Array([1]), CFG)
    await expect(sink(new Uint8Array([2]), { host: '192.168.1.9', port: 9100 })).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(2)
    receipt.resolve()
    await slow
  })

  it('hạn mỗi job lớn dần theo cỡ job', () => {
    expect(jobTimeoutMs(new Uint8Array(0))).toBe(20_000)
    expect(jobTimeoutMs(new Uint8Array(100_000))).toBe(30_000)
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
