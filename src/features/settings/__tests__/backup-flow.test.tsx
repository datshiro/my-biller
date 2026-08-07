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

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
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
