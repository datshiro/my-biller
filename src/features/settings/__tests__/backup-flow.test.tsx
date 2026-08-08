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

/**
 * Bản sao an toàn có thể xuất ra được mà không nhập lại được (bản build cũ, sửa tay qua DevTools).
 * Chặn cứng ở đó thì người bán mắc kẹt: không nhập được file mới mà cũng không xoá được để bắt đầu
 * lại. Nên vẫn cho đi, qua một cửa thứ ba nói thẳng là mất hẳn.
 */
describe('bản sao an toàn không nhập lại được', () => {
  /** Ghi thẳng vào bảng, không qua schema: `collectBackup` xuất được, `parseBackupFile` từ chối. */
  const addOddItem = () =>
    db.items.add({
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: NOW,
      updatedAt: NOW,
    })

  const wipeUpToSecondGate = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Xoá toàn bộ dữ liệu' }))
    await userEvent.type(screen.getByLabelText('Gõ XOA'), 'XOA')
    await userEvent.click(screen.getByRole('button', { name: 'SAO LƯU RỒI XOÁ' }))
  }

  it('xoá sạch: dữ liệu lành thì vẫn chỉ hai cửa như cũ', async () => {
    await seedItem()
    renderPage()

    await wipeUpToSecondGate()

    expect(await screen.findByText('Đã thấy file trong máy chưa?')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Đã thấy — xoá tất cả' }))
    await waitFor(async () => expect(await db.items.count()).toBe(0))
  })

  it('xoá sạch: file hỏng thì dừng ở cửa thứ ba, huỷ ở đó là chưa xoá gì', async () => {
    await seedItem()
    await addOddItem()
    renderPage()

    await wipeUpToSecondGate()
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))

    const gate = await screen.findByText('File vừa tải về KHÔNG nhập lại được')
    expect(gate).toBeDefined()
    expect(screen.getByText(/data\.items\.\d+\.unitPrice/)).toBeDefined()
    expect(downloads).toEqual(['my-biller-backup-260807-1400.json'])

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(await db.items.count()).toBe(2)
  })

  it('xoá sạch: qua cửa thứ ba thì mới thật sự xoá', async () => {
    await seedItem()
    await addOddItem()
    renderPage()

    await wipeUpToSecondGate()
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vẫn xoá — mất cũng được' }))

    await waitFor(async () => expect(await db.items.count()).toBe(0))
  })

  it('nhập file: file hỏng thì thêm cửa thứ ba, chưa ghi đè cho tới khi qua nó', async () => {
    await seedItem()
    const file = await collectBackup(NOW)
    await db.items.clear()
    await createItem({ name: 'Bún', groupId: null, unit: 'tô', unitPrice: 40_000, costPrice: null, isActive: 1 })
    await addOddItem()
    renderPage()

    pick(JSON.stringify(file))
    await userEvent.click(await screen.findByRole('button', { name: 'Tải file an toàn' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Đã thấy — đọc tiếp' }))

    expect(await screen.findByText('File an toàn vừa tải về KHÔNG nhập lại được')).toBeDefined()
    // Chưa đụng gì tới DB: vẫn là dữ liệu hiện tại, chưa phải dữ liệu trong file.
    expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Bún', 'Hàng lạ'])

    await userEvent.click(screen.getByRole('button', { name: 'Vẫn ghi đè — mất cũng được' }))
    await waitFor(async () => expect((await db.items.toArray()).map((item) => item.name)).toEqual(['Phở']))
  })

  /**
   * Khe lỗi của ô "Gõ XOA" nói về chữ người bán vừa gõ. Đổ lỗi sao lưu vào đó thì câu lỗi đọc như
   * "chữ XOA sai định dạng", và người bán sửa cái không hỏng.
   */
  it('lỗi không xuất được file hiện ra như báo động, không phải như lỗi của ô nhập', async () => {
    await seedItem()
    URL.createObjectURL = vi.fn(() => {
      throw new Error('Webview chặn tải file.')
    })
    renderPage()

    await wipeUpToSecondGate()

    expect((await screen.findByRole('alert')).textContent).toMatch(/Webview chặn tải file/)
    expect(screen.getByLabelText('Gõ XOA').getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByText('Đã thấy file trong máy chưa?')).toBeNull()
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
