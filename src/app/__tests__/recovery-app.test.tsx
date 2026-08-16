// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecoveryApp } from '../recovery-app'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { getAppState } from '@/db/repositories/settings'

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}))

let downloads: string[]

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  downloads = []
  URL.createObjectURL = vi.fn(() => 'blob:recovery')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RecoveryApp', () => {
  it('chỉ hiện summary và tải snapshot mà không ghi ledger/outbox', async () => {
    await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })

    render(<RecoveryApp />)

    expect(await screen.findByRole('heading', { name: 'Phục hồi dữ liệu — chỉ đọc' })).toBeDefined()
    expect(await screen.findByText(/0 đơn · 1 mặt hàng/)).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Bán' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Kéo lại từ đầu/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'TẢI FILE SAO LƯU' }))

    await waitFor(() => expect(downloads).toHaveLength(1))
    expect((await getAppState()).lastBackupAt).toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })

  it('cảnh báo storage container rỗng trước khi cho tải', async () => {
    render(<RecoveryApp />)
    await screen.findByText(/0 đơn · 0 mặt hàng/)

    await userEvent.click(screen.getByRole('button', { name: 'TẢI FILE SAO LƯU' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Bản sao chưa có dữ liệu bán hàng' })
    expect(dialog.textContent).toMatch(/đúng Safari hoặc app trên Màn hình chính/)
    expect(downloads).toEqual([])

    await userEvent.click(within(dialog).getByRole('button', { name: 'VẪN TẢI FILE' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
  })
})
