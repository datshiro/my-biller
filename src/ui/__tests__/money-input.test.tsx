// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoneyInput } from '../money-input'

afterEach(cleanup)

function Harness({ onValue }: { onValue: (value: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null)
  return (
    <MoneyInput
      label="Giá bán"
      value={value}
      quickAdd
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

const priceBox = () => screen.getByLabelText('Giá bán') as HTMLInputElement

describe('MoneyInput', () => {
  it('gõ "45k" cho ra 45000 và hiển thị 45.000', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    await userEvent.type(priceBox(), '45k')

    expect(onValue).toHaveBeenLastCalledWith(45_000)
    expect(priceBox().value).toBe('45.000')
  })

  it('chèn dấu phân nhóm ngay khi gõ', async () => {
    render(<Harness onValue={vi.fn()} />)

    await userEvent.type(priceBox(), '1250000')

    expect(priceBox().value).toBe('1.250.000')
  })

  it('xoá bớt một chữ số thì bỏ đúng một chữ số, không vỡ định dạng', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    await userEvent.type(priceBox(), '45000')
    await userEvent.type(priceBox(), '{backspace}')

    expect(priceBox().value).toBe('4.500')
    expect(onValue).toHaveBeenLastCalledWith(4_500)
  })

  it('nút +5k cộng dồn vào giá đang có', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    await userEvent.type(priceBox(), '10000')
    await userEvent.click(screen.getByRole('button', { name: '+5k' }))

    expect(onValue).toHaveBeenLastCalledWith(15_000)
    expect(priceBox().value).toBe('15.000')
  })

  it('cha đổi giá trị từ bên ngoài thì ô hiện theo', async () => {
    function Outside() {
      const [value, setValue] = useState<number | null>(113_000)
      return (
        <>
          <MoneyInput label="Khách đưa" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue(200_000)}>
            200.000
          </button>
        </>
      )
    }
    render(<Outside />)

    await userEvent.click(screen.getByRole('button', { name: '200.000' }))

    expect((screen.getByLabelText('Khách đưa') as HTMLInputElement).value).toBe('200.000')
  })

  it('đang gõ dở chuỗi chưa hợp lệ thì không bị ô tự xoá chữ', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    // "k" đứng một mình chưa ra số nào, nhưng người dùng đang gõ dở "k" của "45k" thì phải giữ lại.
    await userEvent.type(priceBox(), 'k')

    expect(priceBox().value).toBe('k')
    expect(onValue).toHaveBeenLastCalledWith(null)
  })

  it('nút Xoá đưa ô về rỗng và trả null', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    await userEvent.type(priceBox(), '10000')
    await userEvent.click(screen.getByRole('button', { name: 'Xoá' }))

    expect(onValue).toHaveBeenLastCalledWith(null)
    expect(priceBox().value).toBe('')
  })
})
