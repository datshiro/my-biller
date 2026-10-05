import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  savePairedDevice,
} from '../repositories/device-state'
import { createItem } from '../repositories/items'
import {
  applyCustomerImport,
  applyItemImport,
  ImportChangedError,
} from '../repositories/nhap-file'
import type { CustomerRow, ItemRow } from '@/domain/nhap-file'
import { installTestDevice } from '@/test-fixtures'
import type { OutboxRow } from '../sync/outbox'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

async function pairDevice(): Promise<void> {
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: crypto.randomUUID(),
    label: 'Máy A',
    letter: 'A',
    shopId: crypto.randomUUID(),
    token: 't'.repeat(43),
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
}

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return { line: 2, group: '', name: 'Trà đá', unit: 'Ly', unitPrice: 3_000, costPrice: null, note: '', ...overrides }
}

function customerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return { line: 2, name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '', ...overrides }
}

describe('applyItemImport — máy chưa ghép', () => {
  it('nhập 3 món (1 nhóm mới) ra đúng bản ghi, outbox rỗng', async () => {
    const rows = [
      itemRow({ line: 2, name: 'Trà đá', group: 'Đồ uống' }),
      itemRow({ line: 3, name: 'Phở bò', group: 'Đồ ăn' }),
      itemRow({ line: 4, name: 'Cà phê', group: 'Đồ uống' }),
    ]
    const result = await applyItemImport(rows, 'skip')
    expect(result).toMatchObject({ created: 3, updated: 0, groupsCreated: 2, queued: false, duplicatesInactive: 0 })
    expect(await db.items.count()).toBe(3)
    expect(await db.itemGroups.count()).toBe(2)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('applyItemImport — máy đã ghép', () => {
  it('cùng file ra outbox có 4 sự kiện cùng một txId, nhóm đứng trước món của nó', async () => {
    await pairDevice()
    const rows = [itemRow({ line: 2, name: 'Trà đá', group: 'Đồ uống' }), itemRow({ line: 3, name: 'Phở bò', group: 'Đồ ăn' })]
    const result = await applyItemImport(rows, 'skip')
    expect(result.queued).toBe(true)

    const events = (await db.outbox.orderBy('id').toArray()) as OutboxRow[]
    expect(events).toHaveLength(4) // 2 nhóm + 2 món
    const txIds = new Set(events.map((e) => e.txId))
    expect(txIds.size).toBe(1)
    expect(new Set(events.map((e) => e.txOrder)).size).toBe(4)

    const groupEvents = events.filter((e) => e.table === 'itemGroups')
    const itemEvents = events.filter((e) => e.table === 'items')
    for (const itemEvent of itemEvents) {
      const groupGid = itemEvent.refs.groupId
      expect(groupGid).not.toBeNull()
      const ownerGroup = groupEvents.find((g) => g.entityGid === groupGid)!
      expect(ownerGroup.id!).toBeLessThan(itemEvent.id!)
    }
  })

  it('6 món xen kẽ nhóm mới/không nhóm/nhóm có sẵn: mọi sự kiện món của "Bánh" đứng sau sự kiện tạo "Bánh"', async () => {
    await pairDevice()
    const existingGroupId = await db.itemGroups.add({
      gid: crypto.randomUUID(),
      name: 'Nước',
      sortOrder: 1,
      optionGroups: [],
      toppingMenu: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await db.outbox.clear()

    const rows = [
      itemRow({ line: 2, name: 'Bánh mì', group: 'Bánh' }),
      itemRow({ line: 3, name: 'Trà chanh', group: '' }),
      itemRow({ line: 4, name: 'Nước suối', group: 'Nước' }),
      itemRow({ line: 5, name: 'Bánh bao', group: 'BÁNH' }),
      itemRow({ line: 6, name: 'Sting', group: '' }),
      itemRow({ line: 7, name: 'Bánh flan', group: 'bánh' }),
    ]
    const result = await applyItemImport(rows, 'skip')
    expect(result.groupsCreated).toBe(1)

    const events = (await db.outbox.toArray()) as OutboxRow[]
    expect(events).toHaveLength(7) // 1 nhóm "Bánh" + 6 món
    const txIds = new Set(events.map((e) => e.txId))
    expect(txIds.size).toBe(1)

    const banhGroupEvent = events.find((e) => e.table === 'itemGroups')!
    const banhItemEvents = events.filter(
      (e) => e.table === 'items' && e.refs.groupId === banhGroupEvent.entityGid,
    )
    expect(banhItemEvents).toHaveLength(3) // Bánh mì, Bánh bao, Bánh flan
    for (const e of banhItemEvents) expect(banhGroupEvent.id!).toBeLessThan(e.id!)

    const noGroupEvents = events.filter((e) => e.table === 'items' && e.refs.groupId === null)
    expect(noGroupEvents).toHaveLength(2) // Trà chanh, Sting

    const existingGroupGid = (await db.itemGroups.get(existingGroupId))!.gid
    const nuocEvent = events.find(
      (e) => e.table === 'items' && e.refs.groupId === existingGroupGid,
    )!
    expect(nuocEvent).toBeDefined()
  })
})

describe('applyItemImport — chính sách bỏ qua/cập nhật', () => {
  it("'skip': items/itemGroups/outbox không đổi, kể cả khi dòng trùng gán nhóm chưa có", async () => {
    await pairDevice()
    const id = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    await db.outbox.clear()

    const result = await applyItemImport([itemRow({ name: 'Trà đá', group: 'Nước', unitPrice: 4_000 })], 'skip')
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, groupsCreated: 0 })
    expect(await db.items.get(id)).toMatchObject({ unitPrice: 3_000, groupId: null })
    expect(await db.itemGroups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it("'update': giá đổi, số bản ghi không đổi, gid/isActive giữ nguyên, sự kiện là put", async () => {
    await pairDevice()
    const id = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const before = (await db.items.get(id))!
    await db.outbox.clear()

    await applyItemImport([itemRow({ name: 'Trà đá', unitPrice: 4_000 })], 'update')
    const after = (await db.items.get(id))!
    expect(after.unitPrice).toBe(4_000)
    expect(after.gid).toBe(before.gid)
    expect(after.isActive).toBe(1)
    expect(await db.items.count()).toBe(1)
    const event = ((await db.outbox.toArray()) as OutboxRow[])[0]!
    expect(event.operation).toBe('put')
  })

  it("trùng một món đang ngừng bán, 'update': giá đổi nhưng isActive vẫn 0, duplicatesInactive đếm đúng", async () => {
    const id = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 0 })

    const result = await applyItemImport([itemRow({ name: 'Trà đá', unitPrice: 4_000 })], 'update')
    expect(result.duplicatesInactive).toBe(1)
    expect((await db.items.get(id))!.isActive).toBe(0)
    expect((await db.items.get(id))!.unitPrice).toBe(4_000)
  })

  it('file chỉ toàn món đang bán: duplicatesInactive là 0', async () => {
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const result = await applyItemImport([itemRow({ name: 'Trà đá', unitPrice: 4_000 })], 'update')
    expect(result.duplicatesInactive).toBe(0)
  })

  it("nhập lại đúng file đó với 'update': unchanged = số dòng, outbox không thêm gì", async () => {
    await pairDevice()
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    await db.outbox.clear()

    const result = await applyItemImport([itemRow({ name: 'Trà đá', unitPrice: 3_000, unit: 'Ly', note: '' })], 'update')
    expect(result).toMatchObject({ unchanged: 1, updated: 0 })
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('applyItemImport — ImportChangedError', () => {
  it('thêm "Trà đá" vào DB sau lúc dựng rows: update thì cập nhật, không tạo bản thứ hai', async () => {
    const existingId = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const result = await applyItemImport([itemRow({ name: 'trà đá', unitPrice: 5_000 })], 'update')
    expect(result.updated).toBe(1)
    expect(await db.items.count()).toBe(1)
    expect((await db.items.get(existingId))!.unitPrice).toBe(5_000)
  })

  it('thêm một "Trà đá" thứ hai (thành mơ hồ) thì ném ImportChangedError, DB không đổi', async () => {
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_500, costPrice: null, isActive: 1 })
    await expect(applyItemImport([itemRow({ name: 'trà đá', unitPrice: 5_000 })], 'update')).rejects.toThrow(
      ImportChangedError,
    )
    expect(await db.items.count()).toBe(2)
  })

  it('lỗi giữa chừng (unitPrice: -1 làm ItemSchema.parse ném) thì không ghi gì, outbox rỗng', async () => {
    await pairDevice()
    const rows = [
      itemRow({ line: 2, name: 'A', group: 'Nhóm mới' }),
      itemRow({ line: 3, name: 'B' }),
      { ...itemRow({ line: 4, name: 'C' }), unitPrice: -1 },
      itemRow({ line: 5, name: 'D' }),
    ]
    await expect(applyItemImport(rows, 'skip')).rejects.toThrow()
    expect(await db.items.count()).toBe(0)
    expect(await db.itemGroups.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('applyItemImport — đang ghép thì không ghi', () => {
  it('ném thông điệp của syncTransaction, không ghi gì', async () => {
    const pairing = await beginDevicePairing()
    void pairing
    await expect(applyItemImport([itemRow()], 'skip')).rejects.toThrow('Máy đang ghép vào sổ chung')
    expect(await db.items.count()).toBe(0)
  })
})

describe('applyItemImport — hiệu năng', () => {
  it('500 món mới trên máy đã ghép: đúng 500 sự kiện + số nhóm mới', async () => {
    await pairDevice()
    const rows = Array.from({ length: 500 }, (_, i) => itemRow({ line: i + 2, name: `Món mới ${i}`, group: `Nhóm ${i % 10}` }))
    const start = performance.now()
    const result = await applyItemImport(rows, 'skip')
    const elapsed = performance.now() - start
    expect(result.created).toBe(500)
    expect(result.groupsCreated).toBe(10)
    expect(await db.outbox.count()).toBe(510)
    console.log(`500 món mới: ${elapsed.toFixed(0)}ms`)
  })
})

describe('applyCustomerImport', () => {
  it('khớp SĐT thì đổi tên + địa chỉ, không đẻ bản ghi', async () => {
    const existingId = await (
      await import('../repositories/customers')
    ).createCustomer({ name: 'Anh Hùng', phone: '0912 345 678', address: '', note: 'Khách quen' })
    const result = await applyCustomerImport(
      [customerRow({ name: 'Anh Hùng Mới', phone: '0912345678', address: '5 Lê Lợi' })],
      'update',
    )
    expect(result.updated).toBe(1)
    const row = (await db.customers.get(existingId))!
    expect(row.name).toBe('Anh Hùng Mới')
    expect(row.address).toBe('5 Lê Lợi')
    expect(row.note).toBe('Khách quen')
    expect(await db.customers.count()).toBe(1)
  })

  it('dòng không SĐT khớp theo tên', async () => {
    const existingId = await (
      await import('../repositories/customers')
    ).createCustomer({ name: 'Anh Hùng', phone: '0912 345 678', address: '', note: '' })
    const result = await applyCustomerImport([customerRow({ name: 'anh hùng', phone: '', note: 'VIP' })], 'update')
    expect(result.updated).toBe(1)
    const row = (await db.customers.get(existingId))!
    expect(row.name).toBe('Anh Hùng') // không đổi tên khi khớp theo tên
    expect(row.note).toBe('VIP')
  })
})
