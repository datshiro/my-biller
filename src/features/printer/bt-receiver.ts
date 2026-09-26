import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { fromBase64, toBase64 } from '@/domain/base64'
import { encodeJob } from '@/domain/escpos/encode'
import { JobFramer } from '@/domain/escpos/job-framer'
import { encodePng1 } from '@/domain/escpos/png-1bit'
import { composeBitmap, layoutBlocks, type LaidBlock } from '@/domain/escpos/reflow'
import { parseJob } from '@/domain/escpos/stream'
import { loadRowFonts, rasterizeRow } from './bt-rasterize'
import { readPrinterConfig, type PrinterConfig } from './printer-config'
import { nativeSink, type PrinterSink } from './printer-sink'

export type BluetoothPrinterPlugin = {
  start(): Promise<{ name: string }>
  stop(): Promise<void>
  addListener(
    event: 'connection',
    fn: (e: { state: 'connected' | 'disconnected'; device: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'data', fn: (e: { base64: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'error', fn: (e: { message: string }) => void): Promise<PluginListenerHandle>
}

export type JobEntry = {
  id: number
  at: number
  device: string
  status: 'printing' | 'printed' | 'failed'
  message?: string
  previewUrl?: string
  /** Byte ESC/POS đã dựng lại — giữ để IN LẠI không phải dựng lần nữa. */
  job?: Uint8Array
}

export type ReceiverState = {
  phase: 'off' | 'starting' | 'listening' | 'error'
  /** Tên Bluetooth của máy này — tên người gửi chọn khi ghép. */
  name?: string
  /** Máy gửi đang nối. */
  device?: string
  error?: string
  log: JobEntry[]
}

export type ReceiverDeps = {
  plugin: BluetoothPrinterPlugin
  render: (laid: LaidBlock[]) => Promise<{ job: Uint8Array; previewUrl: string }>
  sink: PrinterSink
  readConfig: () => PrinterConfig | null
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/**
 * Người gửi im lặng quá chừng này (không cắt giấy, không đóng nối) thì coi như hết job. Đang dở một lệnh
 * thì không tính — cắt ngang lệnh là hỏng cả hai nửa; nối đóng mới chốt.
 */
export const IDLE_MS = 2000
/**
 * Nhưng dở một lệnh mà im quá chừng này (ảnh khai 100 hàng chỉ tới 10, `ESC` lẻ cuối job) thì bỏ phần dở
 * và báo lỗi — đợi tiếp thì job sau bị nuốt làm dữ liệu ảnh, không ra gì mà cũng không báo gì.
 */
export const MID_COMMAND_MAX_MS = 10_000
const LOG_LIMIT = 20

function startErrorMessage(caught: unknown): string {
  switch ((caught as { code?: unknown }).code) {
    case 'ENOBT':
      return 'Máy này không có Bluetooth.'
    case 'EBTOFF':
      return 'Bluetooth đang tắt — bật Bluetooth rồi bấm BẬT lại.'
    case 'EPERM':
      return 'Chưa cho phép quyền Bluetooth (Thiết bị ở gần) cho app.'
    default:
      return caught instanceof Error && caught.message ? caught.message : 'Không mở được Bluetooth.'
  }
}

export function createBtReceiver(deps: ReceiverDeps) {
  let state: ReceiverState = { phase: 'off', log: [] }
  const listeners = new Set<() => void>()
  let handles: PluginListenerHandle[] = []
  const framer = new JobFramer()
  let idle: unknown = null
  // Máy in nhận một nối TCP một lúc: mọi lần gửi (job mới, in lại) xếp hàng qua đây.
  let queue: Promise<void> = Promise.resolve()
  let nextId = 1

  const set = (patch: Partial<ReceiverState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const addEntry = (entry: JobEntry) => set({ log: [entry, ...state.log].slice(0, LOG_LIMIT) })
  const updateEntry = (id: number, patch: Partial<JobEntry>) =>
    set({ log: state.log.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) })

  /** Dựng lại cũng nằm trong hàng: job sau dựng xong trước vẫn phải ra giấy sau. */
  const enqueue = (id: number, build: () => Promise<Uint8Array>) => {
    queue = queue.then(async () => {
      try {
        const job = await build()
        const cfg = deps.readConfig()
        if (!cfg) throw new Error('Chưa cài IP máy in — vào Cài đặt › MÁY IN.')
        await deps.sink(job, cfg)
        updateEntry(id, { status: 'printed', message: undefined })
      } catch (error) {
        updateEntry(id, { status: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  const accept = (bytes: Uint8Array) => {
    const at = deps.now()
    const device = state.device ?? 'Không rõ máy gửi'
    let laid: LaidBlock[]
    try {
      laid = layoutBlocks(parseJob(bytes))
    } catch (error) {
      addEntry({ id: nextId++, at, device, status: 'failed', message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (laid.length === 0) return
    const id = nextId++
    addEntry({ id, at, device, status: 'printing' })
    enqueue(id, async () => {
      const { job, previewUrl } = await deps.render(laid)
      updateEntry(id, { job, previewUrl })
      return job
    })
  }

  const onIdle = () => {
    idle = null
    if (framer.midCommand) idle = deps.setTimer(onStalled, MID_COMMAND_MAX_MS - IDLE_MS)
    else flushNow()
  }

  const onStalled = () => {
    idle = null
    if (!framer.flush()) return
    addEntry({
      id: nextId++,
      at: deps.now(),
      device: state.device ?? 'Không rõ máy gửi',
      status: 'failed',
      message: 'Job dừng giữa chừng một lệnh — máy gửi ngừng gửi byte. Gửi lại từ máy gửi.',
    })
  }

  const flushNow = () => {
    if (idle !== null) deps.clearTimer(idle)
    idle = null
    const rest = framer.flush()
    if (rest) accept(rest)
  }

  const onData = ({ base64 }: { base64: string }) => {
    if (idle !== null) deps.clearTimer(idle)
    for (const job of framer.push(fromBase64(base64))) accept(job)
    idle = deps.setTimer(onIdle, IDLE_MS)
  }

  const attach = async () => {
    if (handles.length > 0) return
    handles = await Promise.all([
      deps.plugin.addListener('data', onData),
      deps.plugin.addListener('connection', ({ state: link, device }) => {
        if (link === 'connected') set({ device })
        else {
          flushNow()
          set({ device: undefined })
        }
      }),
      deps.plugin.addListener('error', ({ message }) => {
        flushNow()
        set({ phase: 'error', device: undefined, error: message || 'Bluetooth đã tắt hoặc mất kết nối — bấm BẬT lại.' })
      }),
    ])
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async start() {
      if (state.phase === 'starting' || state.phase === 'listening') return
      set({ phase: 'starting', error: undefined })
      try {
        await attach()
        const { name } = await deps.plugin.start()
        set({ phase: 'listening', name })
      } catch (error) {
        set({ phase: 'error', error: startErrorMessage(error) })
      }
    },
    async stop() {
      flushNow()
      try {
        await deps.plugin.stop()
      } finally {
        await Promise.all(handles.map((handle) => handle.remove()))
        handles = []
        set({ phase: 'off', device: undefined, error: undefined })
      }
    },
    reprint(id: number) {
      const entry = state.log.find((e) => e.id === id)
      if (!entry?.job || entry.status === 'printing') return
      updateEntry(id, { status: 'printing', message: undefined })
      const job = entry.job
      enqueue(id, async () => job)
    },
    /** Chờ hàng in trống — cho test, không dùng trong app. */
    idle: () => queue,
  }
}

export type BtReceiver = ReturnType<typeof createBtReceiver>

export const BT_ENABLED_KEY = 'nhan-in-bluetooth'

export function readBtEnabled(): boolean {
  try {
    return localStorage.getItem(BT_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveBtEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(BT_ENABLED_KEY, '1')
    else localStorage.removeItem(BT_ENABLED_KEY)
  } catch {
    // Không nhớ được thì lần mở app sau phải bấm BẬT lại — không hỏng gì.
  }
}

async function renderForPrinter(laid: LaidBlock[]) {
  await loadRowFonts()
  const bitmap = composeBitmap(laid, rasterizeRow)
  const png = await encodePng1(bitmap)
  return { job: encodeJob(bitmap), previewUrl: `data:image/png;base64,${toBase64(png)}` }
}

let shared: BtReceiver | null = null

/** Một bộ nhận cho cả app: nghe tiếp khi người bán rời màn Cài đặt, job tới lúc đang bán vẫn in. */
export function getBtReceiver(): BtReceiver {
  shared ??= createBtReceiver({
    plugin: registerPlugin<BluetoothPrinterPlugin>('BluetoothPrinter'),
    render: renderForPrinter,
    sink: nativeSink,
    readConfig: readPrinterConfig,
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
  return shared
}

export function useBtReceiver(receiver: BtReceiver): ReceiverState {
  return useSyncExternalStore(receiver.subscribe, receiver.getState)
}
