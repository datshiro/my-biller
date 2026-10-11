// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SalesPage } from '../sales-page'
import { db } from '@/db/db'
import { createGroup, createItem } from '@/db/repositories/items'
import { createOptionGroup } from '@/db/repositories/option-groups'
import { installTestDevice } from '@/test-fixtures'

let vibrate: ReturnType<typeof vi.fn>

beforeEach(async () => {
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
  vibrate = vi.fn(() => true)
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  delete (navigator as { vibrate?: unknown }).vibrate
})

const seedItems = async () => {
  // Màn bán đọc nhóm lựa chọn dùng chung gắn vào nhóm món, không đọc thực đơn kiểu cũ trên nhóm.
  await createOptionGroup({
    name: 'Đường',
    kind: 'choice',
    choices: ['Ít đường', 'Không đường'],
    required: 0,
    maxSelect: 1,
    defaultChoice: null,
    sortOrder: 1,
    isActive: 1,
  })
  const sugar = (await db.optionGroups.toArray())[0]!
  const groupId = await createGroup({ name: 'Đồ uống', sortOrder: 1, optionGroupGids: [sugar.gid] })
  await createItem({ name: 'Cà phê sữa', groupId, unit: 'ly', unitPrice: 20_000, costPrice: 8_000, isActive: 1 })
  await createItem({ name: 'Trà đá', groupId: null, unit: 'ly', unitPrice: 3_000, costPrice: 500, isActive: 1 })
}

function renderSales() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<SalesPage />} />
        <Route path="/don/:id/phieu" element={<p>Phiếu đã xuất</p>} />
        <Route path="/them/mat-hang/moi" element={<p>Màn thêm mặt hàng</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const dialog = () => within(screen.getByRole('dialog'))

const tapGrid = async (name: string) => {
  const grid = await screen.findByRole('group', { name: 'Mặt hàng' })
  await userEvent.click(within(grid).getByRole('button', { name: new RegExp(name) }))
}

describe('rung khi món vào giỏ ở màn Bán hàng', () => {
  it('chạm món không có thực đơn trong lưới thì rung đúng một lần với 10ms', async () => {
    await seedItems()
    renderSales()

    await tapGrid('Trà đá')
    expect(await screen.findByRole('button', { name: /Xem đơn · 1 món/ })).toBeDefined()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('chạm món có thực đơn chỉ mở sheet, không rung; bấm THÊM mới rung một lần', async () => {
    await seedItems()
    renderSales()

    await tapGrid('Cà phê sữa')
    expect(dialog().getByRole('button', { name: 'Ít đường' })).toBeDefined()
    expect(vibrate).not.toHaveBeenCalled()

    await userEvent.click(dialog().getByRole('button', { name: /^THÊM/ }))
    expect(await screen.findByRole('button', { name: /Xem đơn · 1 món/ })).toBeDefined()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('mở sheet món có thực đơn rồi đóng mà không bấm THÊM thì không rung', async () => {
    await seedItems()
    renderSales()

    await tapGrid('Cà phê sữa')
    expect(dialog().getByRole('button', { name: 'Ít đường' })).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }))

    expect(await screen.findByRole('group', { name: 'Mặt hàng' })).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('gõ "2 tra da, 1 ca phe sua" rồi Enter thì rung đúng một lần, không rung theo từng dòng', async () => {
    await seedItems()
    renderSales()

    await userEvent.type(await screen.findByLabelText(/Tìm món/), '2 tra da, 1 ca phe sua{Enter}')
    expect(await screen.findByRole('button', { name: /Xem đơn · 3 món/ })).toBeDefined()

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('Thêm ly khác tuỳ chọn trong sheet sửa dòng thì rung một lần', async () => {
    await seedItems()
    renderSales()

    await tapGrid('Trà đá')
    await userEvent.click(await screen.findByRole('button', { name: /Xem đơn/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa Trà đá' }))
    vibrate.mockClear()
    await userEvent.click(dialog().getByRole('button', { name: 'Đá riêng' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Thêm ly khác tuỳ chọn' }))

    expect(await screen.findByRole('button', { name: /Sửa Trà đá \(Đá riêng\)/ })).toBeDefined()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('gõ chữ không đọc được rồi Enter thì không rung', async () => {
    await seedItems()
    renderSales()

    await userEvent.type(await screen.findByLabelText(/Tìm món/), 'xyzzy{Enter}')
    expect(await screen.findByText(/Chưa đọc được/)).toBeDefined()

    expect(vibrate).not.toHaveBeenCalled()
  })
})
