// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../confirm-dialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('giữ Tab trong hộp, xử lý Escape và trả focus về chỗ mở', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const firstCancel = vi.fn()
    const nextCancel = vi.fn()
    const { rerender, unmount } = render(
      <ConfirmDialog
        title="Xác nhận"
        message="Nội dung"
        confirmLabel="Tiếp tục"
        onConfirm={() => {}}
        onCancel={firstCancel}
      />,
    )
    const cancel = screen.getByRole('button', { name: 'Huỷ' })
    const confirm = screen.getByRole('button', { name: 'Tiếp tục' })

    expect(document.activeElement).toBe(cancel)
    await userEvent.tab()
    expect(document.activeElement).toBe(confirm)
    await userEvent.tab()
    expect(document.activeElement).toBe(cancel)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(confirm)

    rerender(
      <ConfirmDialog
        title="Xác nhận"
        message="Nội dung mới"
        confirmLabel="Tiếp tục"
        onConfirm={() => {}}
        onCancel={nextCancel}
      />,
    )
    await userEvent.keyboard('{Escape}')
    expect(firstCancel).not.toHaveBeenCalled()
    expect(nextCancel).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('ưu tiên trả focus về nút mở logic khi focus trước hộp không còn đúng', () => {
    const returnFocusRef = createRef<HTMLButtonElement>()
    const opener = document.createElement('button')
    returnFocusRef.current = opener
    document.body.append(opener)

    const { unmount } = render(
      <ConfirmDialog
        title="Xác nhận"
        message="Nội dung"
        confirmLabel="Tiếp tục"
        onConfirm={() => {}}
        onCancel={() => {}}
        returnFocusRef={returnFocusRef}
      />,
    )

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('giữ focus trong hộp và chặn đóng khi thao tác xác nhận đang chạy', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Xác nhận"
        message="Nội dung"
        confirmLabel="Đang tải…"
        onConfirm={onConfirm}
        onCancel={onCancel}
        pending
      />,
    )

    const dialog = screen.getByRole('alertdialog', { name: 'Xác nhận' })
    const cancel = screen.getByRole('button', { name: 'Huỷ' })
    const confirm = screen.getByRole('button', { name: 'Đang tải…' })
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(cancel)

    await userEvent.click(cancel)
    await userEvent.click(confirm)
    await userEvent.keyboard('{Escape}')

    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(confirm)
  })
})
