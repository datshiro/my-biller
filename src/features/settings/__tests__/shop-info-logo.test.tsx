// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShopInfoPage } from '../shop-info-page'
import { db } from '@/db/db'
import { getShop, saveShop } from '@/db/repositories/settings'
import { installTestDevice } from '@/test-fixtures'

const LOGO = 'data:image/png;base64,iVBORw0KGgo='
vi.mock('../shop-logo', () => ({ logoDataUrlFromFile: vi.fn(async () => LOGO) }))
// Tem xem trước dựng ảnh bằng canvas (jsdom không có); ở đây chỉ cần biết màn truyền đúng cấu hình cho nó.
vi.mock('../label-preview', async () => {
  const { createElement } = await import('react')
  return {
    LabelPreview: (props: { name: string; watermark: { enabled: boolean; position: string; align: string; strength: string } }) =>
      createElement('div', {
        'data-testid': 'label-preview',
        'data-name': props.name,
        'data-enabled': String(props.watermark.enabled),
        'data-position': props.watermark.position,
        'data-align': props.watermark.align,
        'data-strength': props.watermark.strength,
      }),
  }
})

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter>
      <ShopInfoPage />
    </MemoryRouter>,
  )
}

async function chọnẢnh() {
  const input = await waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('[data-shop-logo-input]')
    if (!found) throw new Error('chưa có ô chọn ảnh')
    return found
  })
  await userEvent.upload(input, new File(['x'], 'logo.png', { type: 'image/png' }))
  await screen.findByAltText('Logo sẽ in (đen trắng)')
}

async function lưu() {
  await userEvent.click(screen.getByRole('button', { name: 'LƯU THÔNG TIN' }))
}

describe('logo cửa hàng trong Thông tin cửa hàng', () => {
  it('chọn ảnh → thấy bản đen trắng; lưu → sổ có logo, hình chìm vẫn tắt', async () => {
    renderPage()
    await chọnẢnh()
    await lưu()
    await waitFor(async () => expect((await getShop()).logo).toBe(LOGO))
    expect((await getShop()).labelWatermark.enabled).toBe(false)
  })

  it('bật hình chìm ở góc trên phải: lưu đúng cấu hình, không có ô mức đậm', async () => {
    renderPage()
    await chọnẢnh()
    await userEvent.click(screen.getByLabelText('In logo chìm trên tem'))
    expect(screen.getByRole('button', { name: 'Vừa' })).toBeDefined()
    // Đi qua Bên phải rồi mới sang góc: `align` cũ không được nằm lại trong sổ.
    await userEvent.click(screen.getByRole('button', { name: 'Bên phải' }))
    await userEvent.click(screen.getByRole('button', { name: 'Góc trên phải' }))
    expect(screen.queryByRole('button', { name: 'Vừa' })).toBeNull()
    await lưu()
    await waitFor(async () =>
      expect((await getShop()).labelWatermark).toEqual({ enabled: true, position: 'corner', strength: 'light', align: 'center' }),
    )
  })

  it('bên phải: logo chìm dồn nửa phải, vẫn chọn được mức đậm', async () => {
    renderPage()
    await chọnẢnh()
    await userEvent.click(screen.getByLabelText('In logo chìm trên tem'))
    await userEvent.click(screen.getByRole('button', { name: 'Bên phải' }))
    expect(screen.getByRole('button', { name: 'Bên phải' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Đậm' }))
    await lưu()
    await waitFor(async () =>
      expect((await getShop()).labelWatermark).toEqual({ enabled: true, position: 'center', strength: 'dark', align: 'right' }),
    )
  })

  it('tem xem trước đổi theo vị trí và mức đậm đang chọn, và theo tên quán đang gõ', async () => {
    renderPage()
    expect(screen.queryByTestId('label-preview')).toBeNull()
    await chọnẢnh()
    const preview = () => screen.getByTestId('label-preview')
    expect(preview().getAttribute('data-enabled')).toBe('false')

    await userEvent.click(screen.getByLabelText('In logo chìm trên tem'))
    expect(preview().getAttribute('data-enabled')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Bên phải' }))
    expect([preview().getAttribute('data-position'), preview().getAttribute('data-align')]).toEqual(['center', 'right'])
    await userEvent.click(screen.getByRole('button', { name: 'Đậm' }))
    expect(preview().getAttribute('data-strength')).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Góc trên phải' }))
    expect([preview().getAttribute('data-position'), preview().getAttribute('data-align')]).toEqual(['corner', 'center'])

    await userEvent.type(screen.getByLabelText('Tên cửa hàng'), 'Quán Nhỏ')
    expect(preview().getAttribute('data-name')).toBe('Quán Nhỏ')
  })

  it('gỡ logo → lưu → sổ không còn logo và hình chìm tắt', async () => {
    await saveShop({ logo: LOGO, labelWatermark: { enabled: true, position: 'center', strength: 'dark', align: 'center' } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Gỡ logo' }))
    expect(screen.queryByAltText('Logo sẽ in (đen trắng)')).toBeNull()
    await lưu()
    await waitFor(async () => expect((await getShop()).logo).toBeNull())
    expect((await getShop()).labelWatermark.enabled).toBe(false)
  })

  it('chưa có logo thì không có mục hình chìm', async () => {
    renderPage()
    await screen.findByText('Chọn ảnh logo')
    expect(screen.queryByLabelText('In logo chìm trên tem')).toBeNull()
  })
})
