// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaoLuuPage } from '../sao-luu-page'
import { saveRestoreReport, type StoredRestoreReport } from '../restore-report-store'
import { collectBackup } from '@/db/backup'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { installTestDevice, testGid } from '@/test-fixtures'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()

const connectionRow = {
  key: 'connection' as const,
  shopId: testGid(500),
  token: 'token-thu-nghiem-du-dai-cho-ket-noi-1234567890',
  syncUrl: 'https://sync.example.com',
}
const pairingRow = {
  key: 'pairing' as const,
  attemptId: testGid(501),
  hasLocalLedger: false,
  localLedgerRows: 0,
  connectionSaved: false,
  expiresAt: NOW + 60_000,
}
const writeBlockRow = { key: 'writeBlock' as const, reason: 'revoked' as const, shopId: null, createdAt: 1 }

let reload: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  sessionStorage.clear()
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  reload = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SaoLuuPage />
    </MemoryRouter>,
  )

const seedItem = (name = 'Phở') =>
  createItem({ name, groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })

const pick = async (contents: string, name = 'backup.json') =>
  fireEvent.change(await screen.findByLabelText('Chọn file sao lưu'), {
    target: { files: [new File([contents], name, { type: 'application/json' })] },
  })

describe('máy bị chặn khôi phục thấy vì sao và đường đang có', () => {
  it('đã ghép: lời giải thích + Kéo lại từ đầu, không có nút nhập', async () => {
    await db.deviceState.put(connectionRow)
    renderPage()

    expect(await screen.findByText(/Máy này đã ghép sổ chung/)).toBeDefined()
    expect(screen.getByText(/làm trên một máy chưa ghép/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Kéo lại từ đầu' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
    expect(screen.queryByText(/huỷ ghép/i)).toBeNull()
  })

  it('đang ghép: bảo chờ ghép xong, không có nút nhập lẫn Kéo lại', async () => {
    await db.deviceState.put(pairingRow)
    renderPage()

    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Kéo lại từ đầu' })).toBeNull()
  })

  it('bị thu hồi: chỉ đường ghép lại', async () => {
    await db.deviceState.put(writeBlockRow)
    renderPage()

    expect(await screen.findByText(/Máy này đã bị thu hồi khỏi sổ chung/)).toBeDefined()
    expect(screen.getByText(/Cài đặt › Máy bán hàng/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull()
  })

  it('ghép lại máy đã bị thu hồi ⇒ câu đang ghép (đang ghép đứng trước)', async () => {
    await db.deviceState.bulkPut([writeBlockRow, pairingRow])
    renderPage()

    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
    expect(screen.queryByText(/bị thu hồi/)).toBeNull()
  })

  it('ghép bắt đầu ở tab khác ⇒ nút nhập biến mất ngay (đọc live)', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Nhập từ file sao lưu' })).toBeDefined()

    await db.deviceState.put(pairingRow)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Nhập từ file sao lưu' })).toBeNull())
    expect(await screen.findByText(/Máy đang ghép vào sổ chung/)).toBeDefined()
  })

  it('khoá ghi chặn giữa chừng (đua giữa hai tab) ⇒ hiện câu giải thích, không phải câu kỹ thuật', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    renderPage()

    await pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await screen.findByRole('button', { name: 'Đã thấy — ghi đè' })
    await db.deviceState.put(connectionRow)
    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — ghi đè' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/Máy này đã ghép sổ chung/)
    expect(screen.queryByText(/không thể nhập file sao lưu từ đây/)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('ghi đè có xem trước và báo cáo đối chiếu', () => {
  it('hộp xác nhận nói cả số trong file lẫn số đang có trên máy', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await seedItem('Bún')
    renderPage()

    await pick(JSON.stringify(file))

    const dialog = await screen.findByRole('alertdialog', { name: 'Ghi đè toàn bộ dữ liệu?' })
    expect(dialog.textContent).toMatch(/File có 0 đơn · 1 mặt hàng/)
    expect(dialog.textContent).toMatch(/Đang có trên máy: 0 đơn · 2 mặt hàng/)
    expect(await db.items.count()).toBe(2)
  })

  it('ghi đè xong lưu báo cáo vào sessionStorage rồi mới tải lại trang', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await seedItem('Bún')
    renderPage()

    await pick(JSON.stringify(file), 'ban-sao-cu.json')
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — ghi đè' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    const stored = JSON.parse(sessionStorage.getItem('my-biller.restore-report') ?? 'null') as StoredRestoreReport
    expect(stored).toMatchObject({ mode: 'overwrite', sourceName: 'ban-sao-cu.json', report: { ok: true } })
    expect(stored.safety?.savedAs).toBe('my-biller-backup-260807-1400.json')
  })
})

describe('thẻ báo cáo sau khôi phục', () => {
  const stored = (over: Partial<StoredRestoreReport['report']> = {}): StoredRestoreReport => ({
    mode: 'overwrite',
    sourceName: 'ban-sao-cu.json',
    safety: { savedAs: 'an-toan.json', location: 'Tải về (Download)' },
    codeChanges: 0,
    report: {
      ok: true,
      overpaidOrders: 0,
      rows: [
        { key: 'orders', label: 'Đơn', expected: 2, actual: 2, matches: true },
        { key: 'debtTotal', label: 'Tổng nợ', expected: 100_000, actual: 100_000, matches: true },
      ],
      ...over,
    },
  })

  it('khớp ⇒ thẻ "Khôi phục khớp" hiện một lần rồi khoá bị xoá', async () => {
    saveRestoreReport(stored())
    const first = renderPage()

    expect(await screen.findByText('Khôi phục khớp')).toBeDefined()
    expect(screen.getAllByText('100.000 đ').length).toBeGreaterThan(0)
    await waitFor(() => expect(sessionStorage.getItem('my-biller.restore-report')).toBeNull())

    first.unmount()
    renderPage()
    await screen.findByRole('button', { name: 'SAO LƯU RA FILE' })
    expect(screen.queryByText('Khôi phục khớp')).toBeNull()
  })

  it('lệch ⇒ báo động LỆCH kèm bảng lệch và tên file an toàn', async () => {
    saveRestoreReport(
      stored({
        ok: false,
        rows: [
          { key: 'orders', label: 'Đơn', expected: 2, actual: 1, matches: false },
          { key: 'debtTotal', label: 'Tổng nợ', expected: 100_000, actual: 100_000, matches: true },
        ],
      }),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Khôi phục LỆCH ở: Đơn/)
    expect(alert.textContent).toMatch(/an-toan\.json/)
    expect(screen.getByText('LỆCH')).toBeDefined()
  })

  it('có đơn thu vượt tổng ⇒ nói rõ số đơn đó', async () => {
    saveRestoreReport(stored({ overpaidOrders: 2 }))
    renderPage()

    expect(await screen.findByText(/2 đơn có tiền thu vượt tổng đơn/)).toBeDefined()
  })
})

