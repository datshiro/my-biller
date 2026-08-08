// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../settings-page'
import { collectBackup } from '@/db/backup'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { saveAppState } from '@/db/repositories/settings'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

/** Tên các file mà app đã bảo trình duyệt tải về trong một ca test. */
let downloads: string[] = []

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)

  // jsdom không có Blob URL lẫn cơ chế tải file; ghi lại tên file thay cho việc mở thư mục Tải về.
  downloads = []
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )

const seedItem = () =>
  createItem({ name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })

const pick = (contents: string) =>
  fireEvent.change(screen.getByLabelText('Chọn file sao lưu'), {
    target: { files: [new File([contents], 'backup.json', { type: 'application/json' })] },
  })

describe('nhập file sao lưu', () => {
  it('file hỏng: báo lỗi rõ và dữ liệu đang có không suy suyển', async () => {
    await seedItem()
    renderPage()

    pick('{ "app": "my-biller", "version": 1 }')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/hỏng/)
    // Không có hộp xác nhận nghĩa là chưa đi tới bước ghi đè.
    expect(screen.queryByText('Ghi đè toàn bộ dữ liệu?')).toBeNull()
    expect(await db.items.count()).toBe(1)
  })

  it('file của app khác cũng bị chặn trước khi đụng DB', async () => {
    await seedItem()
    renderPage()

    pick(JSON.stringify({ app: 'app-khac', version: 1 }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/ứng dụng khác/)
    expect(await db.items.count()).toBe(1)
  })

  it('file đúng: hỏi xác nhận kèm số bản ghi, chưa ghi gì cho tới khi bấm đồng ý', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    renderPage()

    pick(JSON.stringify(file))

    expect(await screen.findByText('Ghi đè toàn bộ dữ liệu?')).toBeDefined()
    expect(screen.getByText(/1 mặt hàng/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(await db.items.count()).toBe(1)
  })

  /**
   * Cửa thứ hai không phải thủ tục thừa: `exportBackup` chỉ bấm `link.click()` rồi trả về, webview
   * Zalo hay PWA iOS có thể nuốt cú tải mà không báo gì. Ghi đè trước khi người bán tự mắt thấy file
   * là xoá dữ liệu mà không có đường về.
   */
  it('tải file an toàn xong vẫn dừng lại hỏi; chỉ ghi đè sau khi người bán nói đã thấy file', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))

    expect(await screen.findByText('Đã thấy file trong máy chưa?')).toBeDefined()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])
    // Dữ liệu hiện tại còn nguyên: mới chỉ tải file, chưa ghi đè.
    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún'])

    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — ghi đè' }))
    await waitFor(async () => expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Phở']))
  })

  it('huỷ ở cửa thứ hai thì dữ liệu đang có vẫn nguyên', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Huỷ' }))

    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún'])
  })
})

describe('banner nhắc sao lưu', () => {
  it('chưa sao lưu lần nào thì nhắc ngay', async () => {
    renderPage()
    expect(await screen.findByText(/Chưa sao lưu lần nào\./)).toBeDefined()
  })

  it('sao lưu hôm qua thì im lặng', async () => {
    await saveAppState({ lastBackupAt: NOW - DAY })
    renderPage()

    await screen.findByText('Lần cuối: 14:00 ngày 6/8/2026')
    expect(screen.queryByText(/chưa sao lưu/i)).toBeNull()
  })

  it('quá 7 ngày thì nhắc kèm số ngày', async () => {
    await saveAppState({ lastBackupAt: NOW - 8 * DAY })
    renderPage()
    expect(await screen.findByText(/Đã 8 ngày chưa sao lưu/)).toBeDefined()
  })

  it('đóng banner thì nó im 24 giờ chứ không tắt hẳn', async () => {
    await saveAppState({ lastBackupAt: NOW - 8 * DAY })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Ẩn nhắc sao lưu' }))
    await waitFor(() => expect(screen.queryByText(/Đã 8 ngày chưa sao lưu/)).toBeNull())

    cleanup()
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 25 * 60 * 60 * 1000)
    renderPage()
    expect(await screen.findByText(/Đã 9 ngày chưa sao lưu/)).toBeDefined()
  })
})
