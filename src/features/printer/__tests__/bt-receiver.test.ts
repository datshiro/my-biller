import { describe, expect, it, vi } from 'vitest'
import { toBase64 } from '@/domain/base64'
import type { LaidBlock } from '@/domain/escpos/reflow'
import { createBtReceiver, IDLE_MS, MID_COMMAND_MAX_MS, type BluetoothPrinterPlugin, type ReceiverDeps } from '../bt-receiver'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => true } }))

const enc = new TextEncoder()
const CUT = [0x1d, 0x56, 66, 3]
const chunk = (text: string, cut = true) => toBase64(Uint8Array.from([...enc.encode(text), ...(cut ? CUT : [])]))

function setup(overrides: Partial<ReceiverDeps> = {}) {
  const handlers: Record<string, (e: never) => void> = {}
  const plugin = {
    start: vi.fn(async () => ({ name: 'Biller quầy' })),
    stop: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, fn: (e: never) => void) => {
      handlers[event] = fn
      return { remove: vi.fn(async () => {}) }
    }),
  } as unknown as BluetoothPrinterPlugin & { start: ReturnType<typeof vi.fn> }
  let clock = 1_000_000
  const timers: { fn: () => void; at: number; live: boolean }[] = []
  const rendered: LaidBlock[][] = []
  const deps: ReceiverDeps = {
    plugin,
    render: vi.fn(async (laid: LaidBlock[]) => {
      rendered.push(laid)
      return { job: Uint8Array.of(rendered.length), previewUrl: `data:image/png;base64,${rendered.length}` }
    }),
    sink: vi.fn(async () => {}),
    readConfig: () => ({ host: '192.168.1.86', port: 9100 }),
    now: () => clock,
    setTimer: (fn, ms) => {
      const timer = { fn, at: clock + ms, live: true }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => void ((handle as { live: boolean }).live = false),
    ...overrides,
  }
  const receiver = createBtReceiver(deps)
  const emit = (event: 'data' | 'connection' | 'error', payload: object) => handlers[event]?.(payload as never)
  const advance = (ms: number) => {
    clock += ms
    for (const timer of timers) {
      if (timer.live && timer.at <= clock) {
        timer.live = false
        timer.fn()
      }
    }
  }
  return { receiver, deps, plugin, emit, advance, rendered }
}

describe('bộ nhận in Bluetooth', () => {
  it('BẬT → nghe, hiện tên máy; TẮT → dừng plugin', async () => {
    const { receiver, plugin } = setup()
    await receiver.start()
    expect(receiver.getState()).toMatchObject({ phase: 'listening', name: 'Biller quầy' })
    await receiver.stop()
    expect(plugin.stop).toHaveBeenCalled()
    expect(receiver.getState().phase).toBe('off')
  })

  it.each([
    ['EBTOFF', 'Bluetooth đang tắt — bật Bluetooth rồi bấm BẬT lại.'],
    ['EPERM', 'Chưa cho phép quyền Bluetooth (Thiết bị ở gần) cho app.'],
    ['ENOBT', 'Máy này không có Bluetooth.'],
  ])('mở lỗi %s → câu tiếng Việt', async (code, message) => {
    const { receiver, plugin } = setup()
    plugin.start.mockRejectedValueOnce(Object.assign(new Error('x'), { code }))
    await receiver.start()
    expect(receiver.getState()).toMatchObject({ phase: 'error', error: message })
  })

  it('job có lệnh cắt → dựng lại và gửi TCP tới máy in đã cài, nhật ký ghi máy gửi', async () => {
    const { receiver, deps, emit, rendered } = setup()
    await receiver.start()
    emit('connection', { state: 'connected', device: 'Laptop bếp' })
    emit('data', { base64: chunk('Phở bò 45.000đ\n') })
    await receiver.idle()
    expect(rendered[0]).toEqual([expect.objectContaining({ kind: 'text' })])
    expect(deps.sink).toHaveBeenCalledWith(Uint8Array.of(1), { host: '192.168.1.86', port: 9100 })
    expect(receiver.getState().log).toEqual([
      expect.objectContaining({ status: 'printed', device: 'Laptop bếp', previewUrl: 'data:image/png;base64,1' }),
    ])
  })

  it('không có lệnh cắt: in khi người gửi im lặng đủ lâu', async () => {
    const { receiver, deps, emit, advance } = setup()
    await receiver.start()
    emit('data', { base64: chunk('a\n', false) })
    advance(IDLE_MS - 1)
    expect(deps.render).not.toHaveBeenCalled()
    emit('data', { base64: chunk('b\n', false) })
    advance(IDLE_MS - 1)
    expect(deps.render).not.toHaveBeenCalled()
    advance(1)
    await receiver.idle()
    expect(deps.render).toHaveBeenCalledTimes(1)
    expect(deps.sink).toHaveBeenCalledTimes(1)
  })

  it('không có lệnh cắt: in khi đóng nối', async () => {
    const { receiver, deps, emit } = setup()
    await receiver.start()
    emit('connection', { state: 'connected', device: 'Laptop' })
    emit('data', { base64: chunk('a\n', false) })
    emit('connection', { state: 'disconnected', device: 'Laptop' })
    await receiver.idle()
    expect(deps.sink).toHaveBeenCalledTimes(1)
    expect(receiver.getState().device).toBeUndefined()
  })

  it('hai job trên một nối in đúng thứ tự, lần lượt', async () => {
    const order: number[] = []
    const { receiver, emit } = setup({
      sink: vi.fn(async (job: Uint8Array) => void order.push(job[0] ?? 0)),
    })
    await receiver.start()
    emit('data', { base64: toBase64(Uint8Array.from([...enc.encode('một\n'), ...CUT, ...enc.encode('hai\n'), ...CUT])) })
    await receiver.idle()
    expect(order).toEqual([1, 2])
  })

  it('hai bản giống hệt (in 2 liên) đều được in', async () => {
    const { receiver, deps, emit } = setup()
    await receiver.start()
    emit('data', { base64: chunk('x\n') })
    emit('data', { base64: chunk('x\n') })
    await receiver.idle()
    expect(deps.sink).toHaveBeenCalledTimes(2)
  })

  it('im lặng giữa một lệnh ảnh không chốt job; đóng nối mới chốt', async () => {
    const { receiver, deps, emit, advance } = setup()
    await receiver.start()
    emit('data', { base64: toBase64(Uint8Array.of(0x61, 0x0a, 0x1d, 0x76, 0x30, 0, 1, 0, 2, 0, 0xff)) })
    advance(IDLE_MS * 3)
    expect(deps.render).not.toHaveBeenCalled()
    emit('data', { base64: toBase64(Uint8Array.of(0xff, ...CUT)) })
    await receiver.idle()
    expect(deps.sink).toHaveBeenCalledTimes(1)
    expect(receiver.getState().log[0]).toMatchObject({ status: 'printed' })
  })

  it.each([
    ['ảnh khai 100 hàng chỉ tới 1 hàng', Uint8Array.of(0x61, 0x0a, 0x1d, 0x76, 0x30, 0, 1, 0, 100, 0, 0xff)],
    ['ESC lẻ cuối job', Uint8Array.of(0x61, 0x0a, 0x1b)],
  ])('dở một lệnh (%s) mà im quá lâu → báo lỗi, job sau vẫn in', async (_name, bytes) => {
    const { receiver, deps, emit, advance } = setup()
    await receiver.start()
    emit('data', { base64: toBase64(bytes) })
    advance(IDLE_MS)
    advance(MID_COMMAND_MAX_MS - IDLE_MS - 1)
    expect(receiver.getState().log).toHaveLength(0)
    advance(1)
    expect(receiver.getState().log[0]).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('dừng giữa chừng một lệnh'),
    })

    emit('data', { base64: chunk('Phở bò\n') })
    await receiver.idle()
    expect(deps.sink).toHaveBeenCalledTimes(1)
    expect(receiver.getState().log[0]).toMatchObject({ status: 'printed' })
  })

  it('đóng nối khi đang chờ hạn giữa lệnh → chốt phần dở một lần, hạn cũ không ghi thêm', async () => {
    const { receiver, emit, advance } = setup()
    await receiver.start()
    emit('connection', { state: 'connected', device: 'Laptop' })
    emit('data', { base64: toBase64(Uint8Array.of(0x61, 0x0a, 0x1d, 0x76, 0x30, 0, 1, 0, 100, 0, 0xff)) })
    advance(IDLE_MS)
    emit('connection', { state: 'disconnected', device: 'Laptop' })
    await receiver.idle()
    expect(receiver.getState().log).toHaveLength(1)
    advance(MID_COMMAND_MAX_MS)
    expect(receiver.getState().log).toHaveLength(1)
  })

  it('in hỏng thì job gửi lại vẫn được in', async () => {
    const sink = vi.fn<ReceiverDeps['sink']>().mockRejectedValueOnce(new Error('Máy in không trả lời sau 3 giây.'))
    const { receiver, emit } = setup({ sink })
    await receiver.start()
    emit('data', { base64: chunk('x\n') })
    await receiver.idle()
    expect(receiver.getState().log[0]).toMatchObject({ status: 'failed', message: 'Máy in không trả lời sau 3 giây.' })
    emit('data', { base64: chunk('x\n') })
    await receiver.idle()
    expect(sink).toHaveBeenCalledTimes(2)
    expect(receiver.getState().log[0]).toMatchObject({ status: 'printed' })
  })

  it('chưa cài IP máy in → job hỏng với hướng dẫn', async () => {
    const { receiver, emit } = setup({ readConfig: () => null })
    await receiver.start()
    emit('data', { base64: chunk('x\n') })
    await receiver.idle()
    expect(receiver.getState().log[0]).toMatchObject({ status: 'failed', message: 'Chưa cài IP máy in — vào Cài đặt › MÁY IN.' })
  })

  it('lệnh lạ → job hỏng có lý do, không gửi gì ra máy in', async () => {
    const { receiver, deps, emit, advance } = setup()
    await receiver.start()
    emit('data', { base64: toBase64(Uint8Array.of(0x61, 0x1b, 0x5a, 1)) })
    advance(IDLE_MS)
    await receiver.idle()
    expect(deps.sink).not.toHaveBeenCalled()
    expect(receiver.getState().log[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('ESC 0x5A') })
  })

  it('job rỗng (chỉ ESC @) không in, không ghi nhật ký', async () => {
    const { receiver, deps, emit, advance } = setup()
    await receiver.start()
    emit('data', { base64: toBase64(Uint8Array.of(0x1b, 0x40)) })
    advance(IDLE_MS)
    await receiver.idle()
    expect(deps.render).not.toHaveBeenCalled()
    expect(receiver.getState().log).toEqual([])
  })

  it('IN LẠI gửi lại đúng byte đã dựng, không dựng lần nữa', async () => {
    const { receiver, deps, emit } = setup()
    await receiver.start()
    emit('data', { base64: chunk('x\n') })
    await receiver.idle()
    const id = receiver.getState().log[0]!.id
    receiver.reprint(id)
    await receiver.idle()
    expect(deps.render).toHaveBeenCalledTimes(1)
    expect(deps.sink).toHaveBeenNthCalledWith(2, Uint8Array.of(1), expect.anything())
  })

  it('Bluetooth tắt giữa chừng → báo lỗi, phần đang nhận vẫn được in', async () => {
    const { receiver, deps, emit } = setup()
    await receiver.start()
    emit('data', { base64: chunk('x\n', false) })
    emit('error', { message: '' })
    await receiver.idle()
    expect(deps.sink).toHaveBeenCalledTimes(1)
    expect(receiver.getState()).toMatchObject({ phase: 'error', error: 'Bluetooth đã tắt hoặc mất kết nối — bấm BẬT lại.' })
  })
})
