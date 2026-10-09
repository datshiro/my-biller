// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissTopOverlay } from '@/ui/back-dismiss'
import { CollectDebtSheet } from '../collect-debt-sheet'

const collectDebt = vi.hoisted(() => vi.fn<() => Promise<number[]>>())
vi.mock('@/db/repositories/payments', () => ({ collectDebt }))

afterEach(() => {
  cleanup()
  collectDebt.mockReset()
})

function renderSheet() {
  const onClose = vi.fn()
  const onDone = vi.fn()
  render(<CollectDebtSheet customerId={1} name="Anh Hùng" owed={100_000} onDone={onDone} onClose={onClose} />)
  return { onClose, onDone }
}

describe('Back khi Thu nợ', () => {
  it('đang lưu thì Back bị nuốt, lưu xong mới đóng qua onDone', async () => {
    let finish!: (ids: number[]) => void
    collectDebt.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { onClose, onDone } = renderSheet()

    await userEvent.click(screen.getByRole('button', { name: /^THU / }))
    await screen.findByText('Đang lưu…')

    expect(dismissTopOverlay()).toBe(true)
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => finish([1]))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(collectDebt).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('chưa lưu thì Back đóng sheet', () => {
    const { onClose } = renderSheet()

    expect(dismissTopOverlay()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
