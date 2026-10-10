// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../admin-page'
import {
  SECRET,
  SHOP_A,
  customerRow,
  dataPage,
  orderLineRow,
  orderRow,
  overviewA,
  overviewB,
  shopDetailA,
  shopsPage,
  spyStorageWrites,
  unpairedPage,
} from './admin-fixtures'

const network = vi.hoisted(() => ({ failStatus: null as number | null, failBody: {} as Record<string, string> }))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function routeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input))
  if (network.failStatus !== null) {
    const status = network.failStatus
    network.failStatus = null
    return Promise.resolve(json(network.failBody, status))
  }
  const path = url.pathname
  if (path.endsWith('/admin/devices/unpaired')) return Promise.resolve(json(unpairedPage))
  if (path.endsWith(`/admin/shops/${SHOP_A}/data`)) {
    const table = url.searchParams.get('table')
    if (table === 'orderLines') return Promise.resolve(json(dataPage([orderLineRow('order-1', 'Phở bò', 12)])))
    if (table === 'orders') return Promise.resolve(json(dataPage([orderRow(1, 10)], 10)))
    return Promise.resolve(json(dataPage([customerRow('cust-1', 'Chị Lan', 3)])))
  }
  if (path.endsWith(`/admin/shops/${SHOP_A}`)) return Promise.resolve(json(shopDetailA()))
  if (path.endsWith('/admin/shops')) return Promise.resolve(json(shopsPage([overviewA, overviewB], 'cursor-2')))
  return Promise.resolve(json({ error: 'not-found' }, 404))
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(routeFetch)

beforeEach(() => {
  network.failStatus = null
  network.failBody = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminPage />
    </MemoryRouter>,
  )
}

async function signIn(path: string, secret = SECRET) {
  const user = userEvent.setup()
  renderAt(path)
  await user.type(screen.getByLabelText('Mật khẩu xem'), secret)
  await user.click(screen.getByRole('button', { name: 'Vào' }))
  return user
}

function requestUrls(): URL[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0])))
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

describe('khu admin gửi đúng hợp đồng tới Worker', () => {
  it('lần Vào đầu gọi GET /admin/shops?limit=20 kèm Bearer mang đúng mật khẩu vừa nhập', async () => {
    await signIn('/admin')
    await screen.findByRole('heading', { name: 'Các sổ' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(new URL(String(url)).pathname.endsWith('/admin/shops')).toBe(true)
    expect(new URL(String(url)).searchParams.get('limit')).toBe('20')
    expect(headerOf(init, 'authorization')).toBe(`Bearer ${SECRET}`)
  })

  it('bấm qua mọi màn và mọi nút chỉ phát GET, mọi lời gọi /data đều có limit, mọi lời gọi đều mang Bearer', async () => {
    const user = await signIn(`/admin/so/${SHOP_A}`)
    await screen.findByRole('button', { name: 'Công nợ' })
    await user.click(await screen.findByRole('button', { name: 'Tải thêm' }))
    await user.click(screen.getByRole('button', { name: 'Khách' }))
    await screen.findByText(/Chị Lan/)
    await user.click(screen.getByRole('button', { name: 'Công nợ' }))
    await user.click(screen.getByRole('button', { name: 'Các sổ' }))
    await screen.findByRole('heading', { name: 'Các sổ' })
    await user.click(screen.getByRole('button', { name: 'Tải thêm' }))
    await user.click(screen.getByRole('button', { name: 'Máy chưa ghép' }))
    await screen.findByRole('heading', { name: 'Máy chưa ghép' })
    await user.click(screen.getByRole('button', { name: 'Đã ghép sau đó' }))
    await user.click(screen.getByRole('button', { name: 'Thoát' }))
    await screen.findByLabelText('Mật khẩu xem')

    expect(fetchMock.mock.calls.length).toBeGreaterThan(5)
    for (const [url, init] of fetchMock.mock.calls) {
      const method = init?.method ?? 'GET'
      expect(method, `lời gọi ${String(url)} không được là ghi`).toBe('GET')
      expect(headerOf(init, 'authorization')).toBe(`Bearer ${SECRET}`)
    }
    for (const url of requestUrls().filter((item) => item.pathname.endsWith('/data'))) {
      expect(Number(url.searchParams.get('limit')), `${url.href} thiếu limit`).toBeGreaterThanOrEqual(1)
    }
  })

  it('không có nút ghi nào (thu hồi, xoá, sửa, lưu, huỷ) trên ba màn', async () => {
    const user = await signIn(`/admin/so/${SHOP_A}`)
    await screen.findByRole('button', { name: 'Công nợ' })
    expect(screen.queryByRole('button', { name: /thu hồi|xoá|sửa|lưu|huỷ|thêm mới/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Máy chưa ghép' }))
    await screen.findByRole('heading', { name: 'Máy chưa ghép' })
    expect(screen.queryByRole('button', { name: /thu hồi|xoá|sửa|lưu|huỷ/i })).toBeNull()
  })
})

describe('mật khẩu xem không lưu ở đâu cả', () => {
  it('sau khi đăng nhập không có gì được ghi vào localStorage hay sessionStorage', async () => {
    const writes = spyStorageWrites()
    await signIn(`/admin/so/${SHOP_A}`)
    await screen.findByRole('button', { name: 'Công nợ' })

    for (const spy of writes) expect(spy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('tải lại trang (mount lại) không giữ phiên, ô nhập mật khẩu hiện lại', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPage />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Mật khẩu xem'), SECRET)
    await user.click(screen.getByRole('button', { name: 'Vào' }))
    await screen.findByRole('heading', { name: 'Các sổ' })
    unmount()

    renderAt('/admin')

    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Các sổ' })).toBeNull()
  })
})

describe('lỗi xác thực và giới hạn tốc độ', () => {
  it('401 khi Vào hiện Sai mật khẩu, không gọi thêm đường nào khác', async () => {
    network.failStatus = 401
    network.failBody = { error: 'unauthorized' }

    await signIn('/admin', 'sai-mat-khau')

    expect(await screen.findByText('Sai mật khẩu')).toBeTruthy()
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).pathname.endsWith('/admin/shops'))).toBe(true)
  })

  it('429 khi Vào hiện Thử lại sau một phút', async () => {
    network.failStatus = 429
    network.failBody = { error: 'rate-limited' }

    await signIn('/admin')

    expect(await screen.findByText('Thử lại sau một phút')).toBeTruthy()
    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
  })

  it('401 giữa phiên (ở Tải thêm) đưa người dùng về ô nhập và không giữ phiên cũ', async () => {
    const user = await signIn('/admin')
    await screen.findByRole('heading', { name: 'Các sổ' })

    network.failStatus = 401
    network.failBody = { error: 'unauthorized' }
    await user.click(screen.getByRole('button', { name: 'Tải thêm' }))

    await waitFor(() => expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Các sổ' })).toBeNull()
  })
})
