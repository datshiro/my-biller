// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ItemFormPage } from '../item-form-page'
import { ItemListPage } from '../item-list-page'
import { db } from '@/db/db'
import { createItem, listItems } from '@/db/repositories/items'

afterEach(cleanup)

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/them/mat-hang" element={<ItemListPage />} />
        <Route path="/them/mat-hang/moi" element={<ItemFormPage />} />
        <Route path="/them/mat-hang/:id" element={<ItemFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('thêm mặt hàng', () => {
  it('gõ tên + "45k" rồi Lưu → DB ghi đúng 45000 đồng', async () => {
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Bún bò đặc biệt')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '45k')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))

    await waitFor(async () => {
      expect(await listItems()).toEqual([
        expect.objectContaining({ name: 'Bún bò đặc biệt', unitPrice: 45_000, costPrice: null, isActive: 1 }),
      ])
    })
  })

  it('thiếu tên hoặc thiếu giá thì báo lỗi ngay tại trường và không ghi gì', async () => {
    renderAt('/them/mat-hang/moi')

    await userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))

    expect(await screen.findByText('Nhập tên mặt hàng.')).toBeDefined()
    expect(screen.getByText('Nhập giá bán.')).toBeDefined()
    expect(await db.items.count()).toBe(0)
  })

  it('cảnh báo lỗ khi giá nhập ≥ giá bán nhưng vẫn cho lưu', async () => {
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Trà đá')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '3000')
    await userEvent.type(screen.getByLabelText('Giá nhập (tuỳ chọn)'), '5000')

    expect(screen.getByText(/đang lỗ/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))
    await waitFor(async () => expect(await db.items.count()).toBe(1))
  })
})

describe('danh sách mặt hàng', () => {
  const item = (name: string, unitPrice: number) => ({
    name,
    groupId: null,
    unit: 'tô',
    unitPrice,
    costPrice: null,
    isActive: 1 as const,
  })

  it('tìm "pho" ra "Phở bò" dù người dùng không gõ dấu', async () => {
    await createItem(item('Phở bò', 55_000))
    await createItem(item('Bún chả', 40_000))

    renderAt('/them/mat-hang')

    expect(await screen.findByText('Phở bò')).toBeDefined()
    await userEvent.type(screen.getByLabelText('Tìm mặt hàng…'), 'pho')

    expect(screen.getByText('Phở bò')).toBeDefined()
    expect(screen.queryByText('Bún chả')).toBeNull()
  })

  it('chưa có mặt hàng nào thì hiện hướng dẫn việc cần làm, không phải chữ "trống"', async () => {
    renderAt('/them/mat-hang')
    expect(await screen.findByText(/Thêm mặt hàng để bán nhanh hơn/)).toBeDefined()
  })
})
