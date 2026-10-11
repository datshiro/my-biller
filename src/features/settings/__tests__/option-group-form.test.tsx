// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OptionGroupFormPage } from '../option-group-form-page'
import { OptionGroupListPage } from '../option-group-list-page'
import { db } from '@/db/db'
import { createItem } from '@/db/repositories/items'
import { createOptionGroup } from '@/db/repositories/option-groups'
import type { OptionGroupRow } from '@/domain/schema'
import { testGid } from '@/test-fixtures'

afterEach(cleanup)

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/them/nhom-lua-chon" element={<OptionGroupListPage />} />
        <Route path="/them/nhom-lua-chon/moi" element={<OptionGroupFormPage />} />
        <Route path="/them/nhom-lua-chon/:id" element={<OptionGroupFormPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const saveGroup = () => userEvent.click(screen.getByRole('button', { name: 'LƯU NHÓM' }))

const choiceGroup = async (name: string, choices: string[], isActive: 0 | 1 = 1) => {
  const id = await createOptionGroup({
    kind: 'choice',
    name,
    choices,
    required: 0,
    maxSelect: 1,
    defaultChoice: null,
    sortOrder: 1,
    isActive,
  })
  return (await db.optionGroups.get(id))!
}

describe('mẫu và loại nhóm lựa chọn', () => {
  it('mẫu Đường điền đủ trường và lưu được', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.click(await screen.findByRole('button', { name: 'Mẫu Đường' }))

    expect(screen.getByLabelText('Tên nhóm *')).toHaveProperty('value', 'Đường')
    expect(screen.getByLabelText('Các lựa chọn *')).toHaveProperty(
      'value',
      '0% đường, 30% đường, 50% đường, 70% đường, 100% đường',
    )
    expect(screen.getByLabelText('Chọn tối đa')).toHaveProperty('value', '1')
    expect(screen.getByLabelText('Lựa chọn mặc định')).toHaveProperty('value', '100% đường')

    await saveGroup()

    await waitFor(async () => expect(await db.optionGroups.count()).toBe(1))
    expect(await db.optionGroups.toArray()).toEqual([
      expect.objectContaining({
        kind: 'choice',
        name: 'Đường',
        choices: ['0% đường', '30% đường', '50% đường', '70% đường', '100% đường'],
        maxSelect: 1,
        defaultChoice: '100% đường',
        required: 0,
        isActive: 1,
      }),
    ])
    expect(await screen.findByText('Tuỳ chọn · 5 lựa chọn · chọn một · chưa gắn')).toBeDefined()
  })

  it('Ghi chú nhanh chọn tối đa nhiều mục', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.click(await screen.findByRole('button', { name: 'Mẫu Ghi chú nhanh' }))

    const limit = screen.getByLabelText('Chọn tối đa')
    await userEvent.clear(limit)
    await userEvent.type(limit, '3')
    await saveGroup()

    await waitFor(async () => expect(await db.optionGroups.count()).toBe(1))
    expect(await db.optionGroups.toArray()).toEqual([
      expect.objectContaining({ name: 'Ghi chú nhanh', maxSelect: 3, defaultChoice: null, kind: 'choice' }),
    ])
    expect(await screen.findByText('Tuỳ chọn · 5 lựa chọn · chọn tối đa 3 · chưa gắn')).toBeDefined()
  })

  it('nhóm topping với giá riêng; giá để trống là null', async () => {
    const pearlId = await createItem({
      name: 'Trân châu',
      groupId: null,
      unit: 'phần',
      unitPrice: 5_000,
      costPrice: null,
      isActive: 0,
      kind: 'topping',
    })
    const jellyId = await createItem({
      name: 'Thạch',
      groupId: null,
      unit: 'phần',
      unitPrice: 3_000,
      costPrice: null,
      isActive: 0,
      kind: 'topping',
    })
    const [pearl, jelly] = [await db.items.get(pearlId), await db.items.get(jellyId)]

    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.click(await screen.findByRole('button', { name: 'Topping' }))
    await userEvent.click(screen.getByRole('button', { name: /Trân châu/ }))
    await userEvent.click(screen.getByRole('button', { name: /Thạch/ }))
    await userEvent.type(screen.getByLabelText('Tên nhóm *'), 'Topping trà sữa')
    await userEvent.type(screen.getByLabelText('Giá riêng · Trân châu'), '7k')
    await saveGroup()

    await waitFor(async () => expect(await db.optionGroups.count()).toBe(1))
    expect(await db.optionGroups.toArray()).toEqual([
      expect.objectContaining({
        kind: 'topping',
        name: 'Topping trà sữa',
        maxSelect: null,
        toppings: [
          { itemGid: pearl!.gid, price: 7_000 },
          { itemGid: jelly!.gid, price: null },
        ],
      }),
    ])
  })

  it('sửa nhóm đã có không đổi được loại', async () => {
    const sugar = await choiceGroup('Đường', ['Ít đường', 'Không đường'])
    renderAt(`/them/nhom-lua-chon/${sugar.id}`)

    expect(await screen.findByText('Loại: Tuỳ chọn')).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Loại nhóm' })).toBeNull()
  })
})

describe('kiểm lỗi khi lưu nhóm lựa chọn', () => {
  it('thiếu tên thì báo ngay, không ghi gì', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.type(await screen.findByLabelText('Các lựa chọn *'), 'Ít đường')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Nhập tên nhóm.')
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('tuỳ chọn thiếu lựa chọn thì báo ngay, không ghi gì', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.type(await screen.findByLabelText('Tên nhóm *'), 'Mức đá')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Nhập ít nhất một lựa chọn.')
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('chọn tối đa lớn hơn số mục thì chặn kèm số mục đang có', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.type(await screen.findByLabelText('Tên nhóm *'), 'Ghi chú')
    await userEvent.type(screen.getByLabelText('Các lựa chọn *'), 'Ít hành, Không hành')
    const limit = screen.getByLabelText('Chọn tối đa')
    await userEvent.clear(limit)
    await userEvent.type(limit, '3')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Chọn tối đa 3 mà nhóm chỉ có 2 mục.')
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('nhóm topping chưa chọn món nào thì chặn', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.click(await screen.findByRole('button', { name: 'Topping' }))
    await userEvent.type(screen.getByLabelText('Tên nhóm *'), 'Topping')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Chọn ít nhất một món topping.')
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('nhãn trùng với nhóm khác gắn cùng một món thì chặn, giữ nguyên nhóm đang sửa', async () => {
    const sugar = await choiceGroup('Đường', ['Không đường', 'Nhiều đường'])
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

    renderAt(`/them/nhom-lua-chon/${sugar.id}`)
    const choices = await screen.findByLabelText('Các lựa chọn *')
    await userEvent.clear(choices)
    await userEvent.type(choices, 'Ít đường, Nhiều đường')
    await saveGroup()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Món “Cà phê”')
    expect(alert.textContent).toContain('chỉ thuộc một nhóm')
    expect(await db.optionGroups.get(sugar.id!)).toMatchObject({ choices: ['Không đường', 'Nhiều đường'] })
  })

  it('nhóm đang gắn vào món mà thêm nhãn Đá có sẵn thì chặn', async () => {
    const sugar = await choiceGroup('Đường', ['Không đường'])
    await createItem({
      name: 'Trà đá',
      groupId: null,
      unit: 'ly',
      unitPrice: 3_000,
      costPrice: null,
      isActive: 1,
      optionGroupGids: [sugar.gid],
    })

    renderAt(`/them/nhom-lua-chon/${sugar.id}`)
    const choices = await screen.findByLabelText('Các lựa chọn *')
    await userEvent.type(choices, ', Đá riêng')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Đá riêng')
    expect(await db.optionGroups.get(sugar.id!)).toMatchObject({ choices: ['Không đường'] })
  })

  it('nhóm mới thêm nhãn Đá có sẵn thì chặn ngay khi lưu', async () => {
    renderAt('/them/nhom-lua-chon/moi')
    await userEvent.type(await screen.findByLabelText('Tên nhóm *'), 'Kiểu đá')
    await userEvent.type(screen.getByLabelText('Các lựa chọn *'), 'Đá riêng, Nhạt')
    await saveGroup()

    expect((await screen.findByRole('alert')).textContent).toContain('Đá riêng')
    expect(await db.optionGroups.count()).toBe(0)
  })
})

describe('lưu trữ nhóm lựa chọn', () => {
  it('nhóm đang gắn vào món thì không lưu trữ được, và nói rõ đang gắn ở đâu', async () => {
    const sugar = await choiceGroup('Đường', ['Ít đường', 'Không đường'])
    await createItem({
      name: 'Cà phê',
      groupId: null,
      unit: 'ly',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
      optionGroupGids: [sugar.gid],
    })

    renderAt(`/them/nhom-lua-chon/${sugar.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu trữ nhóm này' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Nhóm đang gắn vào món “Cà phê”')
    expect(screen.getByText('Đang gắn vào món “Cà phê”.')).toBeDefined()
    expect((await db.optionGroups.get(sugar.id!))?.isActive).toBe(1)
  })

  it('nhóm chưa gắn thì lưu trữ được, và danh sách hiện "Đã lưu trữ"', async () => {
    const sugar = await choiceGroup('Đường', ['Ít đường', 'Không đường'])

    renderAt(`/them/nhom-lua-chon/${sugar.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu trữ nhóm này' }))

    expect(await screen.findByText('Đã lưu trữ')).toBeDefined()
    expect((await db.optionGroups.get(sugar.id!))?.isActive).toBe(0)
  })
})

describe('dữ liệu cũ của nhóm lựa chọn', () => {
  it('nhóm topping trỏ tới món đã xoá: hiện chip để bỏ, bỏ rồi lưu được và không còn gid đó', async () => {
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
    const groupId = await db.optionGroups.add({
      gid: testGid(60),
      name: 'Topping trà sữa',
      kind: 'topping',
      toppings: [
        { itemGid: pearl!.gid, price: null },
        { itemGid: testGid(61), price: 3_000 },
      ],
      required: 0,
      maxSelect: null,
      defaultChoice: null,
      sortOrder: 1,
      isActive: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    renderAt(`/them/nhom-lua-chon/${groupId}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Món đã xoá · không còn là topping' }))
    await saveGroup()

    await waitFor(async () =>
      expect(await db.optionGroups.get(groupId)).toMatchObject({ toppings: [{ itemGid: pearl!.gid, price: null }] }),
    )
  })

  it('nhóm đã lưu trữ có lựa chọn Đá riêng: Dùng lại bị chặn, vẫn lưu trữ', async () => {
    const groupId = await db.optionGroups.add({
      gid: testGid(62),
      name: 'Kiểu đá cũ',
      kind: 'choice',
      choices: ['Đá riêng', 'Nhạt'],
      required: 0,
      maxSelect: 1,
      defaultChoice: null,
      sortOrder: 1,
      isActive: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies OptionGroupRow)

    renderAt(`/them/nhom-lua-chon/${groupId}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng lại nhóm này' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Đá riêng')
    expect(alert.textContent).toContain('nhóm Đá có sẵn')
    expect((await db.optionGroups.get(groupId))?.isActive).toBe(0)
  })
})
