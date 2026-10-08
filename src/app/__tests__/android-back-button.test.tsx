// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AndroidBackButton } from '../android-back-button'
import { pushBackDismiss } from '@/ui/back-dismiss'

const env = vi.hoisted(() => ({ native: false }))

const capacitor = vi.hoisted(() => ({
  addListener: vi.fn(),
  minimizeApp: vi.fn(() => Promise.resolve()),
  remove: vi.fn(),
  listener: undefined as undefined | ((event: { canGoBack: boolean }) => void),
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: capacitor.addListener, minimizeApp: capacitor.minimizeApp },
}))

vi.mock('@/features/printer/printer-sink', () => ({ isNativeApp: () => env.native }))

const layers: Array<() => void> = []

beforeEach(() => {
  vi.clearAllMocks()
  env.native = true
  capacitor.listener = undefined
  capacitor.addListener.mockImplementation((_event: string, listener: (event: { canGoBack: boolean }) => void) => {
    capacitor.listener = listener
    return Promise.resolve({ remove: capacitor.remove })
  })
  window.history.replaceState(null, '')
})

afterEach(() => {
  cleanup()
  layers.splice(0).forEach((remove) => remove())
})

function PathProbe() {
  const { pathname } = useLocation()
  return <p data-testid="path">{pathname}</p>
}

function renderAt(entries: string[], index: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <AndroidBackButton />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function pressBack() {
  const listener = capacitor.listener
  if (!listener) throw new Error('chưa đăng ký listener backButton')
  await act(async () => {
    listener({ canGoBack: true })
  })
}

const pathOf = () => screen.getByTestId('path').textContent

describe('AndroidBackButton', () => {
  it('trên web không đăng ký listener nào', () => {
    env.native = false
    renderAt(['/don'], 0)

    expect(capacitor.addListener).not.toHaveBeenCalled()
  })

  it('native, Back ở chi tiết đơn có lịch sử thì quay lại trang trước', async () => {
    window.history.replaceState({ idx: 1 }, '')
    renderAt(['/don', '/don/7'], 1)

    expect(capacitor.addListener).toHaveBeenCalledWith('backButton', expect.any(Function))
    await pressBack()

    expect(pathOf()).toBe('/don')
    expect(capacitor.minimizeApp).not.toHaveBeenCalled()
  })

  it('native, Back ở gốc tab thì thu nhỏ app và giữ nguyên đường dẫn', async () => {
    window.history.replaceState({ idx: 1 }, '')
    renderAt(['/don/7', '/don'], 1)

    await pressBack()

    expect(capacitor.minimizeApp).toHaveBeenCalledTimes(1)
    expect(pathOf()).toBe('/don')
  })

  it('native, có lớp overlay thì Back đóng lớp và không đổi đường dẫn', async () => {
    const spy = vi.fn()
    layers.push(pushBackDismiss(spy))
    window.history.replaceState({ idx: 1 }, '')
    renderAt(['/don', '/don/7'], 1)

    await pressBack()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(pathOf()).toBe('/don/7')
    expect(capacitor.minimizeApp).not.toHaveBeenCalled()
  })

  it('unmount sau khi đăng ký xong thì gỡ listener', async () => {
    const { unmount } = renderAt(['/don'], 0)
    await act(async () => {})

    unmount()
    expect(capacitor.remove).toHaveBeenCalledTimes(1)
  })

  it('unmount trước khi Promise đăng ký xong vẫn gỡ listener', async () => {
    const { unmount } = renderAt(['/don'], 0)

    unmount()
    await act(async () => {})
    expect(capacitor.remove).toHaveBeenCalledTimes(1)
  })

  it('StrictMode mount hai lần thì mỗi đăng ký đều được gỡ, không rò listener', async () => {
    const { unmount } = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/don']}>
          <AndroidBackButton />
        </MemoryRouter>
      </StrictMode>,
    )
    await act(async () => {})

    unmount()
    expect(capacitor.addListener).toHaveBeenCalledTimes(2)
    expect(capacitor.remove).toHaveBeenCalledTimes(2)
  })

  it('native, trang sâu không có lịch sử thì Back về trang chủ', async () => {
    window.history.replaceState({ idx: 0 }, '')
    renderAt(['/them/sao-luu'], 0)

    await pressBack()

    expect(pathOf()).toBe('/')
    expect(capacitor.minimizeApp).not.toHaveBeenCalled()
  })
})
