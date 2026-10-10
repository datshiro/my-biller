// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../routes'

const env = vi.hoisted(() => ({ native: false }))

vi.mock('@/features/printer/printer-sink', () => ({ isNativeApp: () => env.native }))
vi.mock('@/features/admin/admin-page', () => ({ default: () => 'KHU-ADMIN-MARKER' }))
vi.mock('@/features/sales/sales-page', () => ({ SalesPage: () => 'SALES-MARKER' }))

beforeEach(() => {
  env.native = false
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('đường /admin/* trên web', () => {
  it('/admin mở khu admin', async () => {
    window.history.replaceState(null, '', '/admin')

    render(<AppRoutes />)

    expect(await screen.findByText('KHU-ADMIN-MARKER')).toBeTruthy()
  })

  it('đường con /admin/so/:shopId mở khu admin, không rơi về màn bán hàng', async () => {
    window.history.replaceState(null, '', '/admin/so/3f9a0c21-0000-4000-8000-0000000000a1')

    render(<AppRoutes />)

    expect(await screen.findByText('KHU-ADMIN-MARKER')).toBeTruthy()
    expect(screen.queryByText('SALES-MARKER')).toBeNull()
  })
})

describe('đường /admin/* trên APK', () => {
  it('không đăng ký: /admin chuyển về / như mọi đường lạ, không hiện khu admin', async () => {
    env.native = true
    window.history.replaceState(null, '', '/admin')

    render(<AppRoutes />)

    expect(await screen.findByText('SALES-MARKER')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByText('KHU-ADMIN-MARKER')).toBeNull()
  })

  it('không đăng ký: /admin/so/:shopId cũng chuyển về /', async () => {
    env.native = true
    window.history.replaceState(null, '', '/admin/so/3f9a0c21-0000-4000-8000-0000000000a1')

    render(<AppRoutes />)

    expect(await screen.findByText('SALES-MARKER')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
  })
})
