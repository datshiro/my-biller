// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../error-boundary'
import { db } from '@/db/db'
import { getAppState } from '@/db/repositories/settings'

const NOW = new Date(2026, 7, 7, 14, 0).getTime()

function Sap({ name }: { name?: string }): never {
  const error = new Error('hỏng rồi')
  if (name) error.name = name
  throw error
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  // React in nguyên vệt lỗi ra console mỗi lần ErrorBoundary bắt được — không phải lỗi của ca test.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('chắn cuối', () => {
  it('lỗi thường vẫn hứa nút tải sao lưu — đó là đường cứu dữ liệu duy nhất', () => {
    render(
      <ErrorBoundary>
        <Sap />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: '⬇ TẢI FILE SAO LƯU' })).toBeTruthy()
  })

  it('chính kho dữ liệu hỏng thì KHÔNG hứa nút đó — nút ấy đi qua đúng Dexie đang hỏng', () => {
    render(
      <ErrorBoundary>
        <Sap name="DatabaseClosedError" />
      </ErrorBoundary>,
    )

    expect(screen.queryByRole('button', { name: '⬇ TẢI FILE SAO LƯU' })).toBeNull()
    expect(screen.getByText(/không mở được/i)).toBeTruthy()
    // Lối ra vẫn còn: mở lại app.
    expect(screen.getByRole('button', { name: 'MỞ LẠI APP' })).toBeTruthy()
  })

  it('bấm đường cứu thật tải file nhập lại được và nói đúng kết quả', async () => {
    render(
      <ErrorBoundary>
        <Sap />
      </ErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: '⬇ TẢI FILE SAO LƯU' }))

    expect(await screen.findByText(/tên đề xuất "my-biller-backup-260807-1400\.json"/)).toBeTruthy()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    expect((await getAppState()).lastBackupAt).toBe(NOW)
  })

  it('bấm đường cứu vẫn tải file không nhập lại được nhưng không đóng dấu an toàn', async () => {
    await db.items.add({
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
    render(
      <ErrorBoundary>
        <Sap />
      </ErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: '⬇ TẢI FILE SAO LƯU' }))

    expect(await screen.findByText(/KHÔNG nhập lại được/)).toBeTruthy()
    expect(screen.getByText(/kiểm tra thư mục Tải về/)).toBeTruthy()
    expect(screen.getByText(/thiết bị có thể đổi tên nếu bị trùng/)).toBeTruthy()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    expect((await getAppState()).lastBackupAt).toBeNull()
  })
})
