// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissTopOverlay, pushBackDismiss, useBackDismiss } from '../back-dismiss'
import { ConfirmDialog } from '../confirm-dialog'
import { Sheet } from '../sheet'

const layers: Array<() => void> = []

function push(handler: () => void) {
  const remove = pushBackDismiss(handler)
  layers.push(remove)
  return remove
}

afterEach(() => {
  cleanup()
  layers.splice(0).forEach((remove) => remove())
  expect(dismissTopOverlay()).toBe(false)
})

function Probe({ onBack }: { onBack: () => void }) {
  useBackDismiss(onBack)
  return null
}

function SheetWithDialog({ onSheetClose, onCancel }: { onSheetClose: () => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet title="Đơn" onClose={onSheetClose}>
      <button type="button" onClick={() => setOpen(true)}>
        Xoá đơn
      </button>
      {open ? (
        <ConfirmDialog
          title="Xoá đơn"
          message="Không hoàn tác được."
          confirmLabel="Xoá"
          onConfirm={() => {}}
          onCancel={onCancel}
        />
      ) : null}
    </Sheet>
  )
}

describe('ngăn xếp Back', () => {
  it('ngăn rỗng thì dismissTopOverlay trả false', () => {
    expect(dismissTopOverlay()).toBe(false)
  })

  it('chỉ lớp trên cùng được gọi, và gọi lại vẫn là lớp đó vì lớp chỉ gỡ khi unmount', () => {
    const a = vi.fn()
    const b = vi.fn()
    push(a)
    push(b)

    expect(dismissTopOverlay()).toBe(true)
    expect(dismissTopOverlay()).toBe(true)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('gỡ lớp dưới trước thì lớp trên vẫn được gọi, gỡ hết thì rỗng', () => {
    const a = vi.fn()
    const b = vi.fn()
    const removeA = push(a)
    const removeB = push(b)

    removeA()
    expect(dismissTopOverlay()).toBe(true)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)

    removeB()
    expect(dismissTopOverlay()).toBe(false)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('useBackDismiss vẽ lại ba lần vẫn chỉ một lớp và gọi handler mới nhất', () => {
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()
    const { rerender, unmount } = render(<Probe onBack={first} />)
    rerender(<Probe onBack={second} />)
    rerender(<Probe onBack={third} />)

    expect(dismissTopOverlay()).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).toHaveBeenCalledTimes(1)

    unmount()
    expect(dismissTopOverlay()).toBe(false)
  })

  it('vẽ lại useBackDismiss không đưa lớp đó lên đỉnh ngăn xếp', () => {
    const first = vi.fn()
    const second = vi.fn()
    const above = vi.fn()
    const { rerender } = render(<Probe onBack={first} />)
    const removeAbove = push(above)
    rerender(<Probe onBack={second} />)

    expect(dismissTopOverlay()).toBe(true)
    expect(above).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    removeAbove()
    expect(dismissTopOverlay()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('hộp thoại mở bằng cú chạm sau nằm trên Sheet: Back đóng hộp, không đóng Sheet', async () => {
    const onSheetClose = vi.fn()
    const onCancel = vi.fn()
    render(<SheetWithDialog onSheetClose={onSheetClose} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: 'Xoá đơn' }))
    screen.getByRole('alertdialog', { name: 'Xoá đơn' })

    expect(dismissTopOverlay()).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSheetClose).not.toHaveBeenCalled()
  })

  it('ConfirmDialog đang pending vẫn nuốt Back nhưng không gọi onCancel', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Xác nhận"
        message="Đang lưu"
        confirmLabel="Xoá"
        onConfirm={() => {}}
        onCancel={onCancel}
        pending
      />,
    )

    expect(dismissTopOverlay()).toBe(true)
    expect(onCancel).not.toHaveBeenCalled()
  })

  // Giới hạn đã biết, không phải hành vi mong muốn: effect của con chạy trước cha nên Sheet mount cùng commit với
  // hộp thoại con lại nằm trên. Ca này báo khi giới hạn đổi; app hiện không mount hai lớp cùng commit.
  it('giới hạn: hộp thoại mount cùng commit với Sheet cha thì Back đóng nhầm Sheet', () => {
    const onSheetClose = vi.fn()
    const onCancel = vi.fn()
    render(
      <Sheet title="Đơn" onClose={onSheetClose}>
        <ConfirmDialog title="Xoá" message="Chắc chưa?" confirmLabel="Xoá" onConfirm={() => {}} onCancel={onCancel} />
      </Sheet>,
    )

    expect(dismissTopOverlay()).toBe(true)
    expect(onSheetClose).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('sau khi unmount Sheet thì ngăn rỗng', () => {
    render(
      <Sheet title="Đơn" onClose={() => {}}>
        nội dung
      </Sheet>,
    )

    cleanup()
    expect(dismissTopOverlay()).toBe(false)
  })
})
