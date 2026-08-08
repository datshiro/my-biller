// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DbBlockGate } from '../db-block-gate'
import { blockDb, resetDbBlock } from '@/db/db-block'

const { updateServiceWorker } = vi.hoisted(() => ({ updateServiceWorker: vi.fn() }))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    updateServiceWorker,
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
  }),
}))

afterEach(() => {
  cleanup()
  resetDbBlock()
  updateServiceWorker.mockClear()
})

describe('cổng chặn kho dữ liệu', () => {
  it('không bị chặn thì app chạy như thường', () => {
    render(
      <DbBlockGate>
        <p>màn bán hàng</p>
      </DbBlockGate>,
    )

    expect(screen.getByText('màn bán hàng')).toBeTruthy()
  })

  it('dữ liệu mới hơn app → thay cả app bằng màn cập nhật, có nút bấm được', async () => {
    render(
      <DbBlockGate>
        <p>màn bán hàng</p>
      </DbBlockGate>,
    )
    act(() => blockDb('stale-app'))

    expect(screen.queryByText('màn bán hàng')).toBeNull()
    expect(screen.getByText('Cần cập nhật app')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'CẬP NHẬT NGAY' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('tab khác giữ kết nối → nói rõ phải đóng tab kia, không im lặng treo', () => {
    render(
      <DbBlockGate>
        <p>màn bán hàng</p>
      </DbBlockGate>,
    )
    act(() => blockDb('other-tab'))

    expect(screen.queryByText('màn bán hàng')).toBeNull()
    expect(screen.getByText('Còn tab khác đang mở app')).toBeTruthy()
  })
})
