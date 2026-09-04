// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateSection } from '../app-update-section'

/** Worker giả: chỉ có `state`, `postMessage` và sự kiện `statechange` — đúng phần component đụng tới. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState
  postMessage = vi.fn()

  constructor(state: ServiceWorkerState = 'installing') {
    super()
    this.state = state
  }

  chuyển(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

type FakeRegistration = {
  installing: FakeWorker | null
  waiting: FakeWorker | null
  active: FakeWorker | null
  update: ReturnType<typeof vi.fn<() => Promise<void>>>
}

/** Mặc định đã có worker active — tức app đã cài xong từ lần mở trước, như mọi lần mở sau đó. */
function fakeRegistration(update: (registration: FakeRegistration) => Promise<void>): FakeRegistration {
  const registration: FakeRegistration = {
    installing: null,
    waiting: null,
    active: new FakeWorker('activated'),
    update: vi.fn(() => update(registration)),
  }
  return registration
}

/** Gắn `navigator.serviceWorker` giả; jsdom vốn không có nó. */
function gắnContainer(registration: FakeRegistration | undefined) {
  const container = Object.assign(new EventTarget(), {
    getRegistration: vi.fn(async () => registration),
  })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  return container
}

afterEach(() => {
  cleanup()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

const nútKiểm = () => screen.getByRole('button', { name: 'KIỂM TRA BẢN MỚI' })
const bịKhoá = (button: HTMLElement) => (button as HTMLButtonElement).disabled

describe('AppUpdateSection', () => {
  it('không có service worker thì nói thẳng là chưa có gì để cập nhật', async () => {
    gắnContainer(undefined)
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())

    await screen.findByText('Chưa có chế độ offline trên bản này, nên không có gì để cập nhật.')
    expect(bịKhoá(nútKiểm())).toBe(false)
  })

  it('kiểm xong mà không có worker mới thì báo đang ở bản mới nhất', async () => {
    const registration = fakeRegistration(async () => {})
    gắnContainer(registration)
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())

    await screen.findByText('Đang dùng bản mới nhất.')
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(bịKhoá(nútKiểm())).toBe(false)
  })

  it('update() lỗi (mất mạng) thì báo lỗi và cho bấm lại', async () => {
    gắnContainer(fakeRegistration(async () => Promise.reject(new TypeError('Failed to fetch'))))
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Không kiểm tra được. Xem lại mạng rồi thử lại.')
    expect(bịKhoá(nútKiểm())).toBe(false)
  })

  it('có bản mới: chờ cài xong, đổi nút thành TẢI LẠI NGAY, bấm thì gửi SKIP_WAITING rồi reload khi đổi controller', async () => {
    const worker = new FakeWorker('installing')
    const registration = fakeRegistration(async (r) => {
      r.installing = worker
    })
    const container = gắnContainer(registration)
    const reload = vi.fn()
    render(<AppUpdateSection reload={reload} />)

    await userEvent.click(nútKiểm())
    expect(bịKhoá(await screen.findByRole('button', { name: 'Đang tải bản mới…' }))).toBe(true)

    act(() => {
      registration.installing = null
      registration.waiting = worker
      worker.chuyển('installed')
    })
    const nútTảiLại = await screen.findByRole('button', { name: 'TẢI LẠI NGAY' })
    expect(screen.getByText(/Đã tải xong bản mới/).textContent).toMatch(/đóng hẳn app rồi mở lại/)

    await userEvent.click(nútTảiLại)
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(bịKhoá(screen.getByRole('button', { name: 'Đang tải lại…' }))).toBe(true)
    expect(reload).not.toHaveBeenCalled()

    act(() => {
      container.dispatchEvent(new Event('controllerchange'))
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('worker mới chết giữa đường (redundant) thì báo không tải được', async () => {
    const worker = new FakeWorker('installing')
    gắnContainer(
      fakeRegistration(async (r) => {
        r.installing = worker
      }),
    )
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())
    await screen.findByRole('button', { name: 'Đang tải bản mới…' })
    act(() => worker.chuyển('redundant'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Không tải được bản mới. Thử lại sau.')
    expect(bịKhoá(nútKiểm())).toBe(false)
  })

  it('lần cài đầu tiên (chưa có worker active) thì không coi worker đang cài là bản mới', async () => {
    // Máy mới mở app lần đầu, SW đầu tiên còn đang precache: worker đó sẽ activate thẳng, không vào
    // `waiting`. Coi nó là "bản mới" thì nút ra TẢI LẠI NGAY rồi bấm là lỗi vì `waiting` rỗng.
    const worker = new FakeWorker('installing')
    const registration = fakeRegistration(async (r) => {
      r.installing = worker
    })
    registration.active = null
    gắnContainer(registration)
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())

    await screen.findByText('Đang dùng bản mới nhất.')
    expect(bịKhoá(nútKiểm())).toBe(false)
  })

  it('đã có worker chờ sẵn (bấm Để sau trước đó) thì ra TẢI LẠI NGAY ngay sau khi kiểm', async () => {
    const registration = fakeRegistration(async () => {})
    registration.waiting = new FakeWorker('installed')
    gắnContainer(registration)
    render(<AppUpdateSection />)

    await userEvent.click(nútKiểm())

    expect(bịKhoá(await screen.findByRole('button', { name: 'TẢI LẠI NGAY' }))).toBe(false)
  })
})
