// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SyncApiError } from '@/db/sync/client'
import { formatVnd } from '@/domain/money'
import { shortId } from '@/domain/short-id'
import AdminPage from '../admin-page'
import {
  INSTALL_PAIRED,
  INSTALL_UNPAIRED,
  SECRET,
  SHOP_A,
  SHOP_B,
  customerRow,
  dataPage,
  digitsOf,
  orderLineRow,
  orderRow,
  overviewA,
  overviewB,
  shopDetailA,
  shopsPage,
  unpairedPage,
} from './admin-fixtures'

const adminClient = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  onUnauthorized: undefined as undefined | (() => void),
}))

vi.mock('../admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../admin-client')>()),
  createAdminClient: adminClient.createAdminClient,
}))

type FakeApi = {
  loadShops: Mock
  loadShop: Mock
  loadData: Mock
  loadOrderLines: Mock
  loadUnpaired: Mock
}

const READ_ONLY_BUTTONS = new Set([
  'Vào',
  'Thoát',
  'Tải thêm',
  'Đơn',
  'Khách',
  'Công nợ',
  'Các sổ',
  'Máy chưa ghép',
  'Đã ghép sau đó',
])

function fakeApi(): FakeApi {
  return {
    loadShops: vi.fn(async () => shopsPage([overviewA, overviewB])),
    loadShop: vi.fn(async () => shopDetailA()),
    loadData: vi.fn(async () => dataPage([])),
    loadOrderLines: vi.fn(async () => dataPage([])),
    loadUnpaired: vi.fn(async () => unpairedPage),
  }
}

let api: FakeApi

beforeEach(() => {
  api = fakeApi()
  adminClient.onUnauthorized = undefined
  adminClient.createAdminClient.mockReset()
  adminClient.createAdminClient.mockImplementation((_secret: string, onUnauthorized: () => void) => {
    adminClient.onUnauthorized = onUnauthorized
    return api
  })
})

afterEach(() => {
  cleanup()
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

function sectionOf(shopId: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(`section[data-shop-id="${shopId}"]`)
  if (!section) throw new Error(`chưa có khối sổ ${shopId}`)
  return section
}

function rowOf(installId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-install-id="${installId}"]`)
  if (!row) throw new Error(`chưa có dòng máy ${installId}`)
  return row
}

function isShown(element: Element | null): boolean {
  if (!element || element.closest('details:not([open])')) return false
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.classList.contains('hidden')) return false
    if ((node as HTMLElement).style.display === 'none') return false
  }
  return true
}

function expectOnlyReadButtons() {
  for (const button of screen.getAllByRole('button')) {
    const label = button.textContent?.trim() ?? ''
    expect(READ_ONLY_BUTTONS.has(label), `nút "${label}" không thuộc tập chỉ đọc`).toBe(true)
  }
}

describe('cổng mật khẩu xem', () => {
  it('hiện ô Mật khẩu xem kiểu password và nút Vào trước khi nhập', () => {
    renderAt('/admin')

    expect(screen.getByLabelText('Mật khẩu xem').getAttribute('type')).toBe('password')
    expect(screen.getByRole('button', { name: 'Vào' })).toBeTruthy()
  })

  it('Vào với mật khẩu đúng tạo khách với secret vừa nhập và hiện tiêu đề Các sổ', async () => {
    await signIn('/admin')

    expect(adminClient.createAdminClient).toHaveBeenCalledWith(SECRET, expect.any(Function))
    expect(await screen.findByRole('heading', { name: 'Các sổ' })).toBeTruthy()
  })

  it('401 hiện Sai mật khẩu và giữ người dùng ở ô nhập', async () => {
    api.loadShops.mockRejectedValueOnce(new SyncApiError('Sai mật khẩu', 'unauthorized', 401))

    await signIn('/admin', 'sai-mat-khau')

    expect(await screen.findByText('Sai mật khẩu')).toBeTruthy()
    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Các sổ' })).toBeNull()
  })

  it('429 hiện Thử lại sau một phút', async () => {
    api.loadShops.mockRejectedValueOnce(new SyncApiError('Thử lại sau', 'rate-limited', 429))

    await signIn('/admin')

    expect(await screen.findByText('Thử lại sau một phút')).toBeTruthy()
    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
  })

  it('đường con /admin/so/:id cũng hỏi mật khẩu trước, rồi mới hiện ba tab', async () => {
    renderAt(`/admin/so/${SHOP_A}`)

    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Công nợ' })).toBeNull()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Mật khẩu xem'), SECRET)
    await user.click(screen.getByRole('button', { name: 'Vào' }))

    expect(await screen.findByRole('button', { name: 'Công nợ' })).toBeTruthy()
    expect(api.loadShop).toHaveBeenCalledWith(SHOP_A)
  })

  it('Thoát xoá phiên và đưa về ô nhập mật khẩu', async () => {
    const user = await signIn('/admin')
    await screen.findByRole('heading', { name: 'Các sổ' })

    await user.click(screen.getByRole('button', { name: 'Thoát' }))

    expect(screen.getByLabelText('Mật khẩu xem')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Các sổ' })).toBeNull()
  })

  it('401 giữa phiên (onUnauthorized) xoá phiên và đưa về ô nhập', async () => {
    await signIn('/admin')
    await screen.findByRole('heading', { name: 'Các sổ' })

    act(() => adminClient.onUnauthorized?.())

    expect(await screen.findByLabelText('Mật khẩu xem')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Các sổ' })).toBeNull()
  })

  it('tải lại trang (mount lại) bắt buộc nhập lại mật khẩu', async () => {
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
    expect(adminClient.createAdminClient).toHaveBeenCalledTimes(1)
  })
})

describe('danh sách sổ /admin', () => {
  it('mỗi sổ một khối data-shop-id với Sổ rút gọn, tên quán và bốn số của chính sổ đó', async () => {
    await signIn('/admin')
    await waitFor(() => expect(sectionOf(SHOP_B)).toBeTruthy())

    const a = sectionOf(SHOP_A)
    expect(a.textContent).toContain(`Sổ: ${shortId(SHOP_A)}`)
    expect(a.textContent).toContain('Quán Cơm A')
    expect(digitsOf(a.querySelector('[data-field="orderCount"]'))).toBe('12')
    expect(digitsOf(a.querySelector('[data-field="customerCount"]'))).toBe('4')
    expect(digitsOf(a.querySelector('[data-field="debtTotal"]'))).toBe('150000')
    expect(digitsOf(a.querySelector('[data-field="revenue"]'))).toBe('2350000')
  })

  it('số của sổ này không lẫn sang khối sổ khác (chỉ đọc trong data-shop-id)', async () => {
    await signIn('/admin')
    await waitFor(() => expect(sectionOf(SHOP_B)).toBeTruthy())

    const b = sectionOf(SHOP_B)
    expect(b.textContent).not.toContain('Quán Cơm A')
    expect(digitsOf(b.querySelector('[data-field="orderCount"]'))).toBe('3')
    expect(digitsOf(b.querySelector('[data-field="customerCount"]'))).toBe('9')
    expect(digitsOf(b.querySelector('[data-field="debtTotal"]'))).toBe('40000')
    expect(digitsOf(b.querySelector('[data-field="revenue"]'))).toBe('500000')
  })

  it('bảng máy hiện tên, đã thu hồi, đã áp tới #N, tụt, chưa kéo lần nào và đang kéo lại', async () => {
    await signIn('/admin')
    await waitFor(() => expect(sectionOf(SHOP_A)).toBeTruthy())

    const text = sectionOf(SHOP_A).textContent ?? ''
    expect(text).toContain('Quầy A')
    expect(text).toContain('Quầy B')
    expect(text).toContain('đã thu hồi')
    expect(text).toMatch(/đã áp tới #5, báo lúc/)
    expect(text).toContain('tụt 2')
    expect(text).toContain('chưa kéo lần nào')
    expect(text).toMatch(/đang kéo lại từ đầu \(từ /)
    expect(text).toContain('tụt 5')
  })

  it('có chú thích độ trễ 60 giây cho số báo của máy', async () => {
    await signIn('/admin')
    await waitFor(() => expect(sectionOf(SHOP_A)).toBeTruthy())

    expect(document.body.textContent).toContain('Số này là lần báo gần nhất của máy, chậm tối đa 60 giây')
  })

  it('Tải thêm lấy trang kế theo next và nối thêm sổ, không thay trang cũ', async () => {
    api.loadShops
      .mockResolvedValueOnce(shopsPage([overviewA], 'cursor-2'))
      .mockResolvedValueOnce(shopsPage([overviewB], null))
    const user = await signIn('/admin')
    await waitFor(() => expect(sectionOf(SHOP_A)).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Tải thêm' }))

    await waitFor(() => expect(sectionOf(SHOP_B)).toBeTruthy())
    expect(sectionOf(SHOP_A)).toBeTruthy()
    expect(api.loadShops.mock.calls[1]?.[0]).toBe('cursor-2')
    expect(screen.queryByRole('button', { name: 'Tải thêm' })).toBeNull()
  })
})

describe('chi tiết sổ /admin/so/:shopId', () => {
  it('đầu trang là khối data-shop-id của sổ đang mở, rồi ba tab Đơn, Khách, Công nợ', async () => {
    renderAt(`/admin/so/${SHOP_A}`)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Mật khẩu xem'), SECRET)
    await user.click(screen.getByRole('button', { name: 'Vào' }))

    await waitFor(() => expect(sectionOf(SHOP_A)).toBeTruthy())
    expect(sectionOf(SHOP_A).textContent).toContain(`Sổ: ${shortId(SHOP_A)}`)
    for (const tab of ['Đơn', 'Khách', 'Công nợ']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    }
    expect(api.loadShop).toHaveBeenCalledWith(SHOP_A)
  })

  it('tab Đơn tải trang đầu theo keyset và lấy dòng đơn của cả trang trong một lần gọi', async () => {
    api.loadData.mockResolvedValueOnce(dataPage([orderRow(1, 10), orderRow(2, 11)], null))
    api.loadOrderLines.mockResolvedValueOnce(
      dataPage([orderLineRow('order-1', 'Phở bò', 12), orderLineRow('order-2', 'Cơm tấm', 13)], null),
    )

    await signIn(`/admin/so/${SHOP_A}`)

    await waitFor(() => expect(api.loadData).toHaveBeenCalledWith(SHOP_A, 'orders', 0))
    await waitFor(() => expect(api.loadOrderLines).toHaveBeenCalledTimes(1))
    expect(api.loadOrderLines.mock.calls[0]?.[0]).toBe(SHOP_A)
    expect(api.loadOrderLines.mock.calls[0]?.[1]).toEqual(['order-1', 'order-2'])

    const order1 = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-entity-key="order-1"]')
      if (!element?.textContent?.includes('Phở bò')) throw new Error('chưa có dòng đơn 1')
      return element
    })
    expect(order1.textContent).not.toContain('Cơm tấm')
  })

  it('Tải thêm đơn lấy trang kế theo next, gọi dòng đơn cho đúng trang đó và khử trùng entityKey', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => orderRow(index + 1, index + 1))
    api.loadData
      .mockResolvedValueOnce(dataPage(firstPage, 50))
      .mockResolvedValueOnce(dataPage([orderRow(50, 60), orderRow(51, 61)], null))
    const user = await signIn(`/admin/so/${SHOP_A}`)
    await waitFor(() => expect(api.loadOrderLines).toHaveBeenCalledTimes(1))

    expect(api.loadOrderLines.mock.calls[0]?.[1]).toHaveLength(50)

    await user.click(await screen.findByRole('button', { name: 'Tải thêm' }))

    await waitFor(() => expect(api.loadData).toHaveBeenCalledWith(SHOP_A, 'orders', 50))
    await waitFor(() => expect(api.loadOrderLines).toHaveBeenCalledTimes(2))
    expect(api.loadOrderLines.mock.calls[1]?.[1]).toContain('order-51')
    expect(document.querySelectorAll('[data-entity-key="order-50"]')).toHaveLength(1)
  })

  it('tab Khách hiện tên khách từ trang khách', async () => {
    api.loadData.mockResolvedValueOnce(dataPage([])).mockResolvedValueOnce(
      dataPage([customerRow('cust-1', 'Chị Lan', 3)], null),
    )
    const user = await signIn(`/admin/so/${SHOP_A}`)
    await waitFor(() => expect(api.loadData).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Khách' }))

    expect(await screen.findByText(/Chị Lan/)).toBeTruthy()
    expect(api.loadData).toHaveBeenLastCalledWith(SHOP_A, 'customers', 0)
  })

  it('tab Công nợ hiện khách nợ và đúng số tiền nợ từ chi tiết sổ', async () => {
    const user = await signIn(`/admin/so/${SHOP_A}`)
    await waitFor(() => expect(api.loadShop).toHaveBeenCalledWith(SHOP_A))

    await user.click(screen.getByRole('button', { name: 'Công nợ' }))

    const debtRow = (await screen.findByText(/Chị Lan/)).closest('li')
    if (!debtRow) throw new Error('chưa có dòng nợ của Chị Lan')
    expect(within(debtRow).getByText(formatVnd(150000))).toBeTruthy()
  })
})

describe('máy chưa ghép /admin/may-chua-ghep', () => {
  it('tiêu đề Máy chưa ghép, dòng Tổng và Mới trong 24 giờ lấy từ data-total và data-new24h', async () => {
    await signIn('/admin/may-chua-ghep')

    expect(await screen.findByRole('heading', { name: 'Máy chưa ghép' })).toBeTruthy()
    expect(document.body.textContent).toContain('Tổng: ')
    expect(document.body.textContent).toContain('Mới trong 24 giờ: ')
    expect(digitsOf(document.querySelector('[data-total]'))).toBe('2')
    expect(digitsOf(document.querySelector('[data-new24h]'))).toBe('1')
  })

  it('mỗi máy một dòng data-install-id và data-last-seen, có Mã máy rút gọn và số của chính máy đó', async () => {
    await signIn('/admin/may-chua-ghep')
    await waitFor(() => expect(rowOf(INSTALL_UNPAIRED)).toBeTruthy())

    const row = rowOf(INSTALL_UNPAIRED)
    expect(row.tagName).toBe('LI')
    expect(row.getAttribute('data-last-seen')).toBe(String(Date.UTC(2026, 9, 8, 3)))
    expect(row.textContent).toContain(`Mã máy: ${shortId(INSTALL_UNPAIRED)}`)
    expect(row.textContent).toContain('Quán Gió')
    expect(row.textContent).toContain('2.15.0')
    expect(digitsOf(row.querySelector('[data-field="orderCount"]'))).toBe('0')
    expect(digitsOf(row.querySelector('[data-field="customerCount"]'))).toBe('0')
    expect(digitsOf(row.querySelector('[data-field="debtTotal"]'))).toBe('0')
  })

  it('máy đã ghép sau đó nằm trong nhóm thu gọn: ẩn mặc định, bấm Đã ghép sau đó thì hiện đúng Sổ đã ghép', async () => {
    const user = await signIn('/admin/may-chua-ghep')
    await waitFor(() => expect(rowOf(INSTALL_UNPAIRED)).toBeTruthy())

    const hidden = document.querySelector(`[data-install-id="${INSTALL_PAIRED}"]`)
    expect(isShown(hidden)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Đã ghép sau đó' }))

    await waitFor(() => expect(isShown(document.querySelector(`[data-install-id="${INSTALL_PAIRED}"]`))).toBe(true))
    expect(rowOf(INSTALL_PAIRED).textContent).toContain(`đã ghép vào Sổ ${shortId(SHOP_A)}`)
    expect(isShown(document.querySelector(`[data-install-id="${INSTALL_UNPAIRED}"]`))).toBe(true)
  })

  it('máy chưa ghép có nhóm Chưa ghép và số của máy đã ghép không lẫn vào máy chưa ghép', async () => {
    await signIn('/admin/may-chua-ghep')
    await waitFor(() => expect(rowOf(INSTALL_UNPAIRED)).toBeTruthy())

    expect(screen.getByText('Chưa ghép')).toBeTruthy()
    expect(digitsOf(rowOf(INSTALL_UNPAIRED).querySelector('[data-field="debtTotal"]'))).toBe('0')
    expect(rowOf(INSTALL_UNPAIRED).textContent).not.toContain('Quán Mới')
  })

  it('có chú thích dữ liệu do máy tự báo, không xác thực', async () => {
    await signIn('/admin/may-chua-ghep')

    expect(await screen.findByText(/do máy tự báo, không xác thực, có thể bị giả/)).toBeTruthy()
  })
})

describe('không có nút ghi', () => {
  it('ở cả ba màn chữ của mọi nút thuộc tập chỉ đọc, và không có nút thu hồi hay sửa', async () => {
    const user = await signIn('/admin')
    await screen.findByRole('heading', { name: 'Các sổ' })
    expectOnlyReadButtons()

    await user.click(screen.getByRole('button', { name: 'Máy chưa ghép' }))
    await screen.findByRole('heading', { name: 'Máy chưa ghép' })
    expectOnlyReadButtons()

    await user.click(screen.getByRole('button', { name: 'Các sổ' }))
    await screen.findByRole('heading', { name: 'Các sổ' })
    await waitFor(() => expect(sectionOf(SHOP_A)).toBeTruthy())
    expectOnlyReadButtons()
    expect(screen.queryByRole('button', { name: /thu hồi|xoá|sửa|lưu|huỷ/i })).toBeNull()
  })
})
