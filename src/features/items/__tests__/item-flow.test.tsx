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
import { createOptionGroup } from '@/db/repositories/option-groups'
import type { Item } from '@/domain/schema'

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
  it('mở từ ô tìm màn Bán hàng thì tên đã gõ được điền sẵn, và chưa coi là chữ chưa lưu', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/them/mat-hang/moi', state: { itemName: 'Bánh mì' } }]}>
        <Routes>
          <Route path="/them/mat-hang/moi" element={<ItemFormPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Tên mặt hàng *')).toHaveProperty('value', 'Bánh mì')
    // Chữ do app mang sang, không phải người bán gõ ở màn này — bấm ✕ không được hỏi "bỏ những gì đang nhập".
    await userEvent.click(screen.getByRole('button', { name: 'Quay lại' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

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

describe('bán lại mặt hàng chặn trùng tên', () => {
  const now = Date.now()
  const rawItem = (overrides: Partial<Item>): Item => ({
    gid: crypto.randomUUID(),
    name: 'Trà đá',
    groupId: null,
    unit: 'ly',
    unitPrice: 3_000,
    costPrice: null,
    isActive: 1,
    note: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })

  it('món ngừng bán trùng tên (không phân biệt hoa thường/khoảng trắng) một món đang bán thì bị chặn, không ghi gì', async () => {
    await db.items.add(rawItem({ name: 'Trà đá', isActive: 1 }))
    const inactiveId = await db.items.add(rawItem({ name: 'trà đá ', isActive: 0 }))

    renderAt(`/them/mat-hang/${inactiveId}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Bán lại mặt hàng này' }))

    expect(await screen.findByText(/Đã có món “Trà đá” đang bán/)).toBeDefined()
    expect(await db.items.get(inactiveId)).toMatchObject({ isActive: 0 })
  })

  it('món ngừng bán chỉ trùng tên một món cũng ngừng bán thì bán lại được', async () => {
    await db.items.add(rawItem({ name: 'Bánh flan', isActive: 0 }))
    const inactiveId = await db.items.add(rawItem({ name: 'Bánh flan', isActive: 0 }))

    renderAt(`/them/mat-hang/${inactiveId}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Bán lại mặt hàng này' }))

    await waitFor(async () => expect(await db.items.get(inactiveId)).toMatchObject({ isActive: 1 }))
  })

  it('món ngừng bán không trùng ai thì bán lại được như cũ', async () => {
    const inactiveId = await db.items.add(rawItem({ name: 'Bánh bao', isActive: 0 }))

    renderAt(`/them/mat-hang/${inactiveId}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Bán lại mặt hàng này' }))

    await waitFor(async () => expect(await db.items.get(inactiveId)).toMatchObject({ isActive: 1 }))
  })
})

describe('món topping và nhóm lựa chọn', () => {
  const choiceGroup = async (name: string, choices: string[]) => {
    const id = await createOptionGroup({
      kind: 'choice',
      name,
      choices,
      required: 0,
      maxSelect: 1,
      defaultChoice: null,
      sortOrder: 1,
      isActive: 1,
    })
    return (await db.optionGroups.get(id))!
  }
  const saveItem = () => userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))

  it('tạo món topping không bán riêng: lưu thành kind topping, isActive 0, lưới hiện "Chỉ bán kèm"', async () => {
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Trân châu')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '5k')
    await userEvent.click(screen.getByRole('button', { name: 'Là topping' }))
    await saveItem()

    await waitFor(async () =>
      expect(await listItems()).toEqual([expect.objectContaining({ name: 'Trân châu', kind: 'topping', isActive: 0 })]),
    )
    expect(await screen.findByText('Chỉ bán kèm')).toBeDefined()
  })

  it('bật "Bán riêng được" thì isActive 1 và lưới không đánh dấu chỉ bán kèm', async () => {
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Thạch')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '3k')
    await userEvent.click(screen.getByRole('button', { name: 'Là topping' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bán riêng được' }))
    await saveItem()

    await waitFor(async () =>
      expect(await listItems()).toEqual([expect.objectContaining({ name: 'Thạch', kind: 'topping', isActive: 1 })]),
    )
    expect(await screen.findByText(/Thạch/)).toBeDefined()
    expect(screen.queryByText('Chỉ bán kèm')).toBeNull()
  })

  it('gắn nhóm lựa chọn vào món: lưu optionGroupGids theo nhóm đã chọn', async () => {
    const sugar = await choiceGroup('Đường', ['Ít đường', 'Không đường'])
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Cà phê sữa')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '25k')
    await userEvent.click(screen.getByRole('button', { name: 'Đường' }))
    await saveItem()

    await waitFor(async () =>
      expect(await listItems()).toEqual([
        expect.objectContaining({ name: 'Cà phê sữa', kind: 'item', isActive: 1, optionGroupGids: [sugar.gid] }),
      ]),
    )
  })

  it('món đang là topping trong nhóm thì không đổi về món thường được; món topping không có nút ngừng bán', async () => {
    const pearlId = await createItem({
      name: 'Trân châu',
      groupId: null,
      unit: 'phần',
      unitPrice: 5_000,
      costPrice: null,
      isActive: 0,
      kind: 'topping',
    })
    const pearl = await db.items.get(pearlId)
    await createOptionGroup({
      kind: 'topping',
      name: 'Topping trà sữa',
      required: 0,
      maxSelect: null,
      defaultChoice: null,
      sortOrder: 1,
      isActive: 1,
      toppings: [{ itemGid: pearl!.gid, price: null }],
    })
    renderAt(`/them/mat-hang/${pearlId}`)

    await userEvent.click(await screen.findByRole('button', { name: 'Là topping' }))
    expect(screen.queryByRole('button', { name: /Ngừng bán|Bán lại/ })).toBeNull()
    await saveItem()

    expect((await screen.findByRole('alert')).textContent).toContain('Món đang là topping trong nhóm “Topping trà sữa”')
    expect((await db.items.get(pearlId))?.kind).toBe('topping')
  })

  it('sửa giá món cũ thiếu kind thì không đẩy kind hay optionGroupGids', async () => {
    const id = await db.items.add({
      gid: crypto.randomUUID(),
      name: 'Bánh flan',
      groupId: null,
      unit: 'cái',
      unitPrice: 10_000,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    renderAt(`/them/mat-hang/${id}`)

    const price = await screen.findByLabelText('Giá bán *')
    await userEvent.clear(price)
    await userEvent.type(price, '12k')
    await saveItem()

    await waitFor(async () => expect((await db.items.get(id))?.unitPrice).toBe(12_000))
    const raw = await db.items.where(':id').equals(id).raw().first()
    expect(raw).not.toHaveProperty('kind')
    expect(raw).not.toHaveProperty('optionGroupGids')
  })
})

describe('ghim món lên đầu màn bán', () => {
  const saveItem = () => userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))
  const plainItem = () =>
    db.items.add({
      gid: crypto.randomUUID(),
      name: 'Bánh flan',
      groupId: null,
      unit: 'cái',
      unitPrice: 10_000,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

  it('ghim rồi bỏ ghim: bỏ ghim ghi pinned: 0 tường minh, không xoá khoá', async () => {
    const id = await plainItem()
    renderAt(`/them/mat-hang/${id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Ghim lên đầu màn bán' }))
    await saveItem()
    await waitFor(async () => expect((await db.items.get(id))?.pinned).toBe(1))
    cleanup()

    renderAt(`/them/mat-hang/${id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Ghim lên đầu màn bán' }))
    await saveItem()
    await waitFor(async () => expect(await db.items.where(':id').equals(id).raw().first()).toHaveProperty('pinned', 0))
  })

  it('máy khác ghim món trong lúc form đang mở thì lưu sửa giá không gỡ ghim đó', async () => {
    const id = await plainItem()
    renderAt(`/them/mat-hang/${id}`)
    const price = await screen.findByLabelText('Giá bán *')

    await db.items.update(id, { pinned: 1 })
    await userEvent.clear(price)
    await userEvent.type(price, '12k')
    await saveItem()

    await waitFor(async () => expect((await db.items.get(id))?.unitPrice).toBe(12_000))
    expect((await db.items.get(id))?.pinned).toBe(1)
  })

  it('sửa giá món chưa từng ghim thì không đẩy khoá pinned', async () => {
    const id = await plainItem()
    renderAt(`/them/mat-hang/${id}`)

    const price = await screen.findByLabelText('Giá bán *')
    await userEvent.clear(price)
    await userEvent.type(price, '12k')
    await saveItem()

    await waitFor(async () => expect((await db.items.get(id))?.unitPrice).toBe(12_000))
    expect(await db.items.where(':id').equals(id).raw().first()).not.toHaveProperty('pinned')
  })
})

describe('trùng tên và nhãn có sẵn trong danh mục', () => {
  const choiceGroup = async (name: string, choices: string[]) => {
    const id = await createOptionGroup({
      kind: 'choice',
      name,
      choices,
      required: 0,
      maxSelect: 1,
      defaultChoice: null,
      sortOrder: 1,
      isActive: 1,
    })
    return (await db.optionGroups.get(id))!
  }
  const saveItem = () => userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))

  it('đặt tên trùng món topping chỉ bán kèm thì báo "(topping chỉ bán kèm)" và không ghi', async () => {
    await createItem({
      name: 'Thạch',
      groupId: null,
      unit: 'phần',
      unitPrice: 3_000,
      costPrice: null,
      isActive: 0,
      kind: 'topping',
    })
    renderAt('/them/mat-hang/moi')

    await userEvent.type(screen.getByLabelText('Tên mặt hàng *'), 'Thạch')
    await userEvent.type(screen.getByLabelText('Giá bán *'), '4k')
    await userEvent.click(screen.getByRole('button', { name: 'LƯU MẶT HÀNG' }))

    expect(await screen.findByText(/Đã có món “Thạch” \(topping chỉ bán kèm\)/)).toBeDefined()
    expect(await db.items.count()).toBe(1)
  })

  it('chỗ trùng nhãn có sẵn ở món khác không chặn sửa giá món này', async () => {
    const sugar = await choiceGroup('Đường', ['Ít đường', 'Không đường'])
    const level = await choiceGroup('Mức ngọt', ['Ít đường', 'Đường đầy'])
    await createItem({
      name: 'Cà phê',
      groupId: null,
      unit: 'ly',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
      optionGroupGids: [sugar.gid, level.gid],
    })
    const phoId = await createItem({
      name: 'Phở bò',
      groupId: null,
      unit: 'tô',
      unitPrice: 55_000,
      costPrice: null,
      isActive: 1,
    })
    renderAt(`/them/mat-hang/${phoId}`)

    const price = await screen.findByLabelText('Giá bán *')
    await userEvent.clear(price)
    await userEvent.type(price, '60k')
    await saveItem()

    await waitFor(async () => expect((await db.items.get(phoId))?.unitPrice).toBe(60_000))
  })
})
