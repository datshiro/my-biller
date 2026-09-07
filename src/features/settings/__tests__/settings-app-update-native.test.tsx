// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'

// Không lái được từ Robot: Robot chạy trên web Chrome, không vào WebView APK. Bật/tắt native qua cờ
// hoisted để kiểm cả hai nhánh render của SettingsPage.
const shim = vi.hoisted(() => ({ native: false }))
vi.mock('../../printer/printer-sink', () => ({
  isNativeApp: () => shim.native,
  isAndroidWeb: () => false,
  nativeSink: vi.fn(),
}))

import { SettingsPage } from '../settings-page'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  shim.native = false
})

const renderPage = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )

describe('Mục CẬP NHẬT APP theo nền tảng', () => {
  it('web: hiện mục cập nhật và nút KIỂM TRA BẢN MỚI', () => {
    shim.native = false
    renderPage()
    expect(screen.getByText('CẬP NHẬT APP')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'KIỂM TRA BẢN MỚI' })).toBeTruthy()
  })

  it('native (APK): ẩn mục cập nhật — cập nhật app bằng cài đè APK (D15)', () => {
    shim.native = true
    renderPage()
    expect(screen.queryByText('CẬP NHẬT APP')).toBeNull()
    expect(screen.queryByRole('button', { name: 'KIỂM TRA BẢN MỚI' })).toBeNull()
  })
})
