import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  saveDeviceIdentity,
  savePairedDevice,
} from '../repositories/device-state'
import { createGroup, createItem, updateGroup, updateItem } from '../repositories/items'
import { stageExistingLedger } from '../sync/outbox'
import type { OutboxRow } from '../sync/outbox'

const GROUP_GID = '00000000-0000-4000-8000-0000000000c1'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: crypto.randomUUID(),
    label: 'Quầy trước',
    letter: 'A',
    shopId: crypto.randomUUID(),
    token: 't'.repeat(43),
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
})

const plainItem = (name = 'Phở') =>
  createItem({ name, groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })

const rawItem = (id: number) => db.items.where(':id').equals(id).raw().first()

describe('trường danh mục của món: dòng cũ không bị ghi đè bằng giá trị điền lúc đọc', () => {
  it('hàng ghi trước khi có kind đọc ra kind "item" và optionGroupGids rỗng, nhưng dòng thô không đổi', async () => {
    const id = await plainItem()

    expect(await rawItem(id)).not.toHaveProperty('kind')
    expect(await rawItem(id)).not.toHaveProperty('optionGroupGids')
    expect(await db.items.get(id)).toMatchObject({ kind: 'item', optionGroupGids: [] })
  })

  it('updateItem trên hàng thiếu kind không ghi kind hay optionGroupGids vào dòng đã lưu và vào outbox', async () => {
    const id = await plainItem()
    const gid = (await rawItem(id))!.gid

    await updateItem(id, { unitPrice: 20_000 })

    const stored = await rawItem(id)
    expect(stored).toMatchObject({ unitPrice: 20_000 })
    expect(stored).not.toHaveProperty('kind')
    expect(stored).not.toHaveProperty('optionGroupGids')

    const puts = (await db.outbox.toArray()).filter(
      (row) => row.table === 'items' && row.entityKey === gid && row.operation === 'put',
    )
    expect(puts).toHaveLength(1)
    expect(puts[0]!.after).toMatchObject({ unitPrice: 20_000 })
    expect(puts[0]!.after).not.toHaveProperty('kind')
    expect(puts[0]!.after).not.toHaveProperty('optionGroupGids')
  })

  it('updateItem có kind trong patch thì ghi kind; hàng đã có kind giữ kind khi sửa trường khác', async () => {
    const plainId = await plainItem()
    const toppingId = await createItem({
      name: 'Trân châu',
      groupId: null,
      unit: 'ly',
      unitPrice: 5_000,
      costPrice: null,
      isActive: 0,
      kind: 'topping',
    })

    await updateItem(toppingId, { unitPrice: 6_000 })
    expect(await rawItem(toppingId)).toMatchObject({ kind: 'topping', unitPrice: 6_000 })

    await updateItem(plainId, { kind: 'topping' })
    expect(await rawItem(plainId)).toMatchObject({ kind: 'topping' })
  })

  it('updateItem đặt optionGroupGids thì được ghi, và không kéo theo kind của hàng thiếu', async () => {
    const id = await plainItem()

    await updateItem(id, { optionGroupGids: [GROUP_GID] })

    expect(await rawItem(id)).toMatchObject({ optionGroupGids: [GROUP_GID] })
    expect(await rawItem(id)).not.toHaveProperty('kind')
  })
})

describe('trường danh mục của nhóm món', () => {
  it('updateGroup trên nhóm thiếu optionGroupGids đổi tên được mà không thêm khoá mới vào dòng', async () => {
    const id = await createGroup({ name: 'Nước', sortOrder: 1 })
    expect(await db.itemGroups.where(':id').equals(id).raw().first()).not.toHaveProperty('optionGroupGids')

    await updateGroup(id, { name: 'Đồ uống' })

    const stored = await db.itemGroups.where(':id').equals(id).raw().first()
    expect(stored).toMatchObject({ name: 'Đồ uống' })
    expect(stored).not.toHaveProperty('optionGroupGids')
    expect(await db.itemGroups.get(id)).toMatchObject({ optionGroupGids: [] })
  })

  it('updateGroup có optionGroupGids trong patch thì ghi xuống dòng', async () => {
    const id = await createGroup({ name: 'Nước', sortOrder: 1 })

    await updateGroup(id, { optionGroupGids: [GROUP_GID] })

    expect(await db.itemGroups.where(':id').equals(id).raw().first()).toMatchObject({ optionGroupGids: [GROUP_GID] })
  })
})

describe('pairing: chụp sổ có sẵn không điền mặc định vào sự kiện', () => {
  it('món ghi trước khi có kind được chụp vào outbox không có kind hay optionGroupGids', async () => {
    const id = await createItem({ name: 'Trà đá', groupId: null, unit: 'ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const gid = (await db.items.where(':id').equals(id).raw().first())!.gid
    await db.outbox.clear()

    await db.transaction('rw', db.tables, (transaction) => stageExistingLedger(transaction))

    const staged = ((await db.outbox.toArray()) as OutboxRow[]).find((row) => row.table === 'items' && row.entityKey === gid)
    expect(staged?.operation).toBe('create')
    expect(staged?.after).toMatchObject({ name: 'Trà đá', unitPrice: 3_000 })
    expect(staged?.after).not.toHaveProperty('kind')
    expect(staged?.after).not.toHaveProperty('optionGroupGids')
  })
})
