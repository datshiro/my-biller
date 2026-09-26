// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BtReceiverSection } from '../bt-receiver-section'
import { BT_ENABLED_KEY, type BtReceiver, type ReceiverState } from '../../printer/bt-receiver'

const shim = vi.hoisted(() => ({ native: false }))
vi.mock('../../printer/printer-sink', () => ({ isNativeApp: () => shim.native, nativeSink: vi.fn() }))

function fakeReceiver(initial: Partial<ReceiverState> = {}) {
  let state: ReceiverState = { phase: 'off', log: [], ...initial }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<ReceiverState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const receiver = {
    getState: () => state,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    start: vi.fn(async () => set({ phase: 'listening', name: 'Biller quầy' })),
    stop: vi.fn(async () => set({ phase: 'off' })),
    reprint: vi.fn(),
    idle: async () => {},
  } satisfies BtReceiver
  return { receiver, set }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  shim.native = false
})

describe('mục NHẬN IN QUA BLUETOOTH', () => {
  it('trên web: nút BẬT khoá, ghi chú chỉ trong app Android', () => {
    const { receiver } = fakeReceiver()
    render(<BtReceiverSection receiver={receiver} />)
    expect((screen.getByRole('button', { name: 'BẬT NHẬN IN' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Chỉ nhận in qua Bluetooth trong app Android cài từ file APK.')).toBeDefined()
  })

  it('native: BẬT → nghe, nhớ để lần mở sau tự bật; TẮT → dừng, quên', async () => {
    shim.native = true
    const { receiver } = fakeReceiver()
    render(<BtReceiverSection receiver={receiver} />)
    await userEvent.click(screen.getByRole('button', { name: 'BẬT NHẬN IN' }))
    expect(receiver.start).toHaveBeenCalled()
    expect(localStorage.getItem(BT_ENABLED_KEY)).toBe('1')
    expect(await screen.findByText('Đang chờ máy gửi — ghép Bluetooth với "Biller quầy"')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'TẮT NHẬN IN' }))
    expect(receiver.stop).toHaveBeenCalled()
    expect(localStorage.getItem(BT_ENABLED_KEY)).toBeNull()
  })

  it('lỗi mở Bluetooth hiện thành cảnh báo', () => {
    shim.native = true
    const { receiver } = fakeReceiver({ phase: 'error', error: 'Bluetooth đang tắt — bật Bluetooth rồi bấm BẬT lại.' })
    render(<BtReceiverSection receiver={receiver} />)
    expect(screen.getByRole('alert').textContent).toBe('Bluetooth đang tắt — bật Bluetooth rồi bấm BẬT lại.')
  })

  it('nhật ký: máy gửi, trạng thái, lý do hỏng; IN LẠI hỏi xác nhận rồi mới in', async () => {
    shim.native = true
    const at = new Date(2026, 8, 26, 9, 5, 7).getTime()
    const { receiver, set } = fakeReceiver({ phase: 'listening', name: 'Biller', device: 'Laptop bếp' })
    render(<BtReceiverSection receiver={receiver} />)
    expect(screen.getByText('Đang nhận từ Laptop bếp')).toBeDefined()

    act(() =>
      set({
        log: [
          { id: 2, at, device: 'Laptop bếp', status: 'failed', message: 'Máy in không trả lời sau 3 giây.', job: Uint8Array.of(1), previewUrl: 'data:image/png;base64,AA' },
          { id: 1, at, device: 'Laptop bếp', status: 'failed', message: 'Lệnh chưa hỗ trợ ESC 0x5A tại vị trí 2' },
        ],
      }),
    )
    expect(screen.getAllByText('In hỏng')).toHaveLength(2)
    expect(screen.getByText('Máy in không trả lời sau 3 giây.')).toBeDefined()
    expect(screen.getByText('Lệnh chưa hỗ trợ ESC 0x5A tại vị trí 2')).toBeDefined()
    expect(screen.getByAltText('Bản xem trước phiếu nhận được')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'IN LẠI' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'IN LẠI' }))
    expect(receiver.reprint).not.toHaveBeenCalled()
    expect(screen.getByText('Phiếu nhận lúc 09:05:07 từ Laptop bếp sẽ in thêm một tờ.')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'In lại' }))
    expect(receiver.reprint).toHaveBeenCalledWith(2)
  })
})
