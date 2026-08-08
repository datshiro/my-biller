// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../error-boundary'

function Sap({ name }: { name?: string }): never {
  const error = new Error('hỏng rồi')
  if (name) error.name = name
  throw error
}

beforeEach(() => {
  // React in nguyên vệt lỗi ra console mỗi lần ErrorBoundary bắt được — không phải lỗi của ca test.
  vi.spyOn(console, 'error').mockImplementation(() => {})
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
})
