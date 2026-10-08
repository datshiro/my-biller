import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  saveDeviceIdentity,
  savePairedDevice,
} from '../../repositories/device-state'
import { createCustomer, deleteCustomer } from '../../repositories/customers'
import { createGroup, createItem, deleteGroup, deleteItem, updateItem } from '../../repositories/items'
import { createOrder } from '../../repositories/orders'
import { savePriceBook } from '../../repositories/customer-prices'
import { applyEvents } from '../applier'
import { claimLeadership } from '../leader'
import { rollbackRejectedTail } from '../pusher'
import { resolveItemNameTaken } from '../item-name-taken'
import type { OutboxRow } from '../outbox'
import type { ServerEvent } from '@shared/sync-events'

let leader: NonNullable<Awaited<ReturnType<typeof claimLeadership>>>

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
  leader = (await claimLeadership(db, crypto.randomUUID(), Date.now()))!
})

/** Mô phỏng món E đã có trên sổ chung, do máy khác tạo — áp thẳng bằng applyEvents, không qua outbox. */
async function seedExistingItem(name: string, unitPrice: number): Promise<{ gid: string; id: number }> {
  const gid = crypto.randomUUID()
  const event: ServerEvent = {
    eventId: crypto.randomUUID(),
    txId: crypto.randomUUID(),
    txOrder: 0,
    seq: 1,
    deviceId: crypto.randomUUID(),
    serverAt: Date.now(),
    table: 'items',
    entityKey: gid,
    entityGid: gid,
    operation: 'create',
    before: null,
    after: {
      gid,
      name,
      groupId: null,
      unit: 'Ly',
      unitPrice,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    },
    refs: { groupId: null },
  }
  await applyEvents([event], leader)
  const row = (await db.items.where('gid').equals(gid).first())!
  return { gid, id: row.id! }
}

async function outboxRowsOf(table: string, entityKey: string): Promise<OutboxRow[]> {
  return (await db.outbox.toArray()).filter((row) => row.table === table && row.entityKey === entityKey)
}

describe('resolveItemNameTaken — nối món (operation: create)', () => {
  it('bán offline rồi bị nối: giữ đơn, dòng đơn trỏ sang món có sẵn, outbox của D biến mất', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const other = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!

    const order = await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [
        { itemId: dId, name: dRow.name, unit: dRow.unit, unitPrice: dRow.unitPrice, costPrice: dRow.costPrice, qty: 1 },
        { itemId: other, name: 'Trà đá', unit: 'Ly', unitPrice: 3_000, costPrice: null, qty: 2 },
      ],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 22_000, method: 'cash', note: '' },
    })

    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    const outboxBefore = await db.outbox.toArray()

    const outcome = await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    expect(await db.items.get(dId)).toBeUndefined()
    expect(await outboxRowsOf('items', dRow.gid)).toHaveLength(0)

    const lines = await db.orderLines.where('orderId').equals(order.id).toArray()
    const dLine = lines.find((line) => line.name === 'Bánh flan')!
    expect(dLine.itemId).toBe(existing.id)
    expect(dLine.unitPrice).toBe(16_000) // giá lúc bán giữ nguyên, không đổi theo giá hiện tại của E

    const otherLine = lines.find((line) => line.name === 'Trà đá')!
    expect(otherLine.itemId).toBe(other)

    const lineEvent = (await outboxRowsOf('orderLines', dLine.gid))[0]!
    expect(lineEvent.refs.itemId).toBe(existing.gid)
    expect((lineEvent.after as { itemId: number }).itemId).toBe(existing.id)

    // Thứ tự các dòng outbox còn lại không đổi: mọi dòng không thuộc D vẫn còn, đúng thứ tự `id`.
    const remainingIds = outboxBefore.filter((r) => !(r.table === 'items' && r.entityKey === dRow.gid)).map((r) => r.id)
    const afterIds = (await db.outbox.toArray()).filter((r) => r.eventId !== dCreate!.eventId).map((r) => r.id)
    expect(afterIds).toEqual(remainingIds)
  })

  it('nối món giữ nguyên phiếu thu của đơn bán offline', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: dId, name: dRow.name, unit: dRow.unit, unitPrice: dRow.unitPrice, costPrice: dRow.costPrice, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 16_000, method: 'cash', note: '' },
    })
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    const paymentsBefore = await db.payments.toArray()
    expect(paymentsBefore).toHaveLength(1)

    expect(await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)).toBe('resolved')

    expect(await db.payments.toArray()).toEqual(paymentsBefore)
  })

  it('D đã bị xoá trước khi bị từ chối: đơn không liên quan vẫn còn, đẩy tiếp được', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const customerId = await createCustomer({ name: 'Khách', phone: '', address: '', note: '' })
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)

    await savePriceBook(customerId, [{ itemId: dId, unitPrice: 14_000 }])
    await deleteItem(dId) // kéo theo xoá giá riêng (deleteByItem)

    const unrelatedOther = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const unrelatedOrder = await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: unrelatedOther, name: 'Trà đá', unit: 'Ly', unitPrice: 3_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 3_000, method: 'cash', note: '' },
    })

    const outcome = await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    expect(await outboxRowsOf('items', dRow.gid)).toHaveLength(0)
    const cpRows = (await db.outbox.toArray()).filter((r) => r.table === 'customerPrices' && r.refs.itemId === dRow.gid)
    expect(cpRows).toHaveLength(0)

    const orderRows = await db.orders.toArray()
    expect(orderRows.map((o) => o.id)).toContain(unrelatedOrder.id)
    const unrelatedOutbox = (await db.outbox.toArray()).filter((r) => r.table === 'orders')
    expect(unrelatedOutbox.length).toBeGreaterThan(0)
  })

  it('D đổi tên offline sau khi tạo: câu báo nói rõ tên cuối vẫn bị gộp', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    await updateItem(dId, { name: 'Flan nhà làm' })

    await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: dId, name: 'Flan nhà làm', unit: 'Ly', unitPrice: 16_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 16_000, method: 'cash', note: '' },
    })

    const outcome = await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')
    const notice = (await db.deviceState.get('notice')) as { message: string } | undefined
    expect(notice?.message).toContain('đã được đổi tên thành “Flan nhà làm”')
    expect(notice?.message).toContain('vẫn được gộp')
  })

  it('giá riêng: E chưa có giá cho K thì giá của D chuyển sang E', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const customerId = await createCustomer({ name: 'Khách', phone: '', address: '', note: '' })
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    await savePriceBook(customerId, [{ itemId: dId, unitPrice: 14_000 }])

    const outcome = await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    const priceRows = await db.customerPrices.where('customerId').equals(customerId).toArray()
    expect(priceRows).toHaveLength(1)
    expect(priceRows[0]!.itemId).toBe(existing.id)
    expect(priceRows[0]!.unitPrice).toBe(14_000)
  })

  it('giá riêng: E đã có giá cho K thì giá của D bị bỏ, giá của E giữ nguyên', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const customerId = await createCustomer({ name: 'Khách', phone: '', address: '', note: '' })
    await savePriceBook(customerId, [{ itemId: existing.id, unitPrice: 13_000 }])
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    await savePriceBook(customerId, [{ itemId: dId, unitPrice: 14_000 }])

    const outcome = await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    const priceRows = await db.customerPrices.where('customerId').equals(customerId).toArray()
    expect(priceRows).toHaveLength(1)
    expect(priceRows[0]!.itemId).toBe(existing.id)
    expect(priceRows[0]!.unitPrice).toBe(13_000)
    const notice = (await db.deviceState.get('notice')) as { message: string } | undefined
    expect(notice?.message).toContain('giá riêng')
  })

  it('món có sẵn chưa về máy: trả deferred, DB và outbox không đổi một byte', async () => {
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    const outboxBefore = await db.outbox.toArray()
    const itemsBefore = await db.items.toArray()

    const outcome = await resolveItemNameTaken(dCreate!, crypto.randomUUID(), 'Bánh flan', leader)
    expect(outcome).toBe('deferred')
    expect(await db.outbox.toArray()).toEqual(outboxBefore)
    expect(await db.items.toArray()).toEqual(itemsBefore)
  })

  it('sau khi nối, một rollbackRejectedTail hợp lệ cho dòng đơn vẫn khớp same() (không bị coi là xung đột)', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    const order = await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: dId, name: 'Bánh flan', unit: 'Ly', unitPrice: 16_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 16_000, method: 'cash', note: '' },
    })

    await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)

    const lineRow = (await db.orderLines.where('orderId').equals(order.id).first())!
    const lineEvent = (await outboxRowsOf('orderLines', lineRow.gid))[0]!
    // Giả một lần ghi KHÁC bị Worker từ chối, với dòng đơn (đã nối) đứng trong đuôi bị cuộn.
    await rollbackRejectedTail(lineEvent, leader, 'Thiếu bản ghi cha itemGroups.')

    // `same()` khớp (current === after) nên dòng được hoàn lại đúng `before` (xoá, vì before === null của create)
    // — nghĩa là KHÔNG rơi vào nhánh xung đột (resyncRequired không bật lên vì dòng này).
    const sync = (await db.deviceState.get('sync')) as { resyncRequired?: boolean } | undefined
    expect(sync?.resyncRequired ?? false).toBe(false)
  })
})

describe('resolveItemNameTaken — món có sẵn đã bị xoá trên máy này', () => {
  /** E về máy, D trùng tên bán offline, người bán xoá E trước khi D kịp đẩy: lần xoá E nằm sau `create D`. */
  async function sellDThenDeleteE() {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const customerId = await createCustomer({ name: 'Khách', phone: '', address: '', note: '' })
    await savePriceBook(customerId, [{ itemId: existing.id, unitPrice: 13_000 }])
    const ePrice = (await db.customerPrices.where('itemId').equals(existing.id).first())!
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const order = await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: dId, name: dRow.name, unit: dRow.unit, unitPrice: dRow.unitPrice, costPrice: dRow.costPrice, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 16_000, method: 'cash', note: '' },
    })
    await deleteItem(existing.id)
    const deleteTxId = (await outboxRowsOf('items', existing.gid)).find((row) => row.operation === 'delete')!.txId
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    return { existing, ePrice, dRow, order, deleteTxId, dCreate: dCreate! }
  }

  it('khôi phục E cùng giá riêng của nó rồi nối D vào, không hoãn mãi', async () => {
    const { existing, ePrice, order, deleteTxId, dCreate } = await sellDThenDeleteE()
    const paymentEventsBefore = (await db.outbox.toArray()).filter((row) => row.table === 'payments')

    const outcome = await resolveItemNameTaken(dCreate, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    expect((await db.items.get(existing.id))?.gid).toBe(existing.gid)
    expect(await db.items.where('name').equals('Bánh flan').count()).toBe(1)
    expect(await db.customerPrices.get(ePrice.id!)).toEqual(ePrice)
    const line = (await db.orderLines.where('orderId').equals(order.id).first())!
    expect(line.itemId).toBe(existing.id)
    expect(line.unitPrice).toBe(16_000)
    expect((await db.outbox.toArray()).filter((row) => row.txId === deleteTxId)).toHaveLength(0)
    expect((await db.outbox.toArray()).filter((row) => row.table === 'payments')).toEqual(paymentEventsBefore)

    const notice = (await db.deviceState.get('notice')) as { message: string } | undefined
    expect(notice?.message).toContain('được khôi phục')
    const sync = (await db.deviceState.get('sync')) as { resyncRequired?: boolean } | undefined
    expect(sync?.resyncRequired ?? false).toBe(false)
  })

  it('khôi phục vấp xung đột giữa chừng: huỷ cả giao dịch, trả deferred, DB và outbox không đổi một byte', async () => {
    const { existing, ePrice, dCreate } = await sellDThenDeleteE()
    // Một giá riêng mang đúng gid của giá đã xoá xuất hiện lại (không qua outbox) → restoreRow của nó trả false
    // SAU khi dòng món E (mới hơn) đã được khôi phục trong cùng giao dịch.
    await db.customerPrices.add({ ...ePrice, id: undefined, itemId: 999_999 })
    const outboxBefore = await db.outbox.toArray()
    const itemsBefore = await db.items.toArray()
    const pricesBefore = await db.customerPrices.toArray()
    const linesBefore = await db.orderLines.toArray()

    const outcome = await resolveItemNameTaken(dCreate, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('deferred')
    expect(await db.outbox.toArray()).toEqual(outboxBefore)
    expect(await db.items.toArray()).toEqual(itemsBefore)
    expect(await db.customerPrices.toArray()).toEqual(pricesBefore)
    expect(await db.orderLines.toArray()).toEqual(linesBefore)
  })

  it('khách của giá riêng E đã bị xoá sau E: không khôi phục E trỏ vào khách đã mất, trả deferred, không đổi gì', async () => {
    const { existing, ePrice, dCreate } = await sellDThenDeleteE()
    await deleteCustomer(ePrice.customerId)
    const outboxBefore = await db.outbox.toArray()
    const itemsBefore = await db.items.toArray()

    expect(await resolveItemNameTaken(dCreate, existing.gid, 'Bánh flan', leader)).toBe('deferred')
    expect(await db.outbox.toArray()).toEqual(outboxBefore)
    expect(await db.items.toArray()).toEqual(itemsBefore)
    expect(await db.customerPrices.get(ePrice.id!)).toBeUndefined()
  })

  it('nhóm của E đã bị xoá sau E: không khôi phục E trỏ vào nhóm đã mất, trả deferred', async () => {
    const groupId = await createGroup({ name: 'Tráng miệng', sortOrder: 0 })
    const existing = await seedExistingItem('Bánh flan', 15_000)
    await db.items.update(existing.id, { groupId })
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const [dCreate] = await outboxRowsOf('items', (await db.items.get(dId))!.gid)
    await deleteItem(existing.id)
    await deleteGroup(groupId)
    const outboxBefore = await db.outbox.toArray()

    expect(await resolveItemNameTaken(dCreate!, existing.gid, 'Bánh flan', leader)).toBe('deferred')
    expect(await db.outbox.toArray()).toEqual(outboxBefore)
    expect(await db.items.get(existing.id)).toBeUndefined()
  })

  it('đổi tên bị chặn khi E đã bị xoá trên máy: vẫn hoàn lại món đó, không hoãn, lần xoá E giữ nguyên để đẩy', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const mId = await createItem({ name: 'Bánh bông lan', groupId: null, unit: 'Ly', unitPrice: 20_000, costPrice: null, isActive: 1 })
    await updateItem(mId, { name: 'Bánh flan' })
    const renamePut = (await outboxRowsOf('items', (await db.items.get(mId))!.gid)).find((row) => row.operation === 'put')!
    await deleteItem(existing.id)

    const outcome = await resolveItemNameTaken(renamePut, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')
    expect((await db.items.get(mId))!.name).toBe('Bánh bông lan')
    expect(await db.items.get(existing.id)).toBeUndefined()
    expect((await outboxRowsOf('items', existing.gid)).map((row) => row.operation)).toEqual(['delete'])
  })

  it('sự kiện bị từ chối không phải món, hoặc existingGid trùng chính nó: trả deferred, không đụng gì', async () => {
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const dRow = (await db.items.get(dId))!
    const [dCreate] = await outboxRowsOf('items', dRow.gid)
    const outboxBefore = await db.outbox.toArray()
    const itemsBefore = await db.items.toArray()

    expect(await resolveItemNameTaken(dCreate!, dRow.gid, 'Bánh flan', leader)).toBe('deferred')
    expect(await resolveItemNameTaken({ ...dCreate!, table: 'customers' }, crypto.randomUUID(), 'Bánh flan', leader)).toBe('deferred')
    expect(await db.outbox.toArray()).toEqual(outboxBefore)
    expect(await db.items.toArray()).toEqual(itemsBefore)
  })
})

describe('resolveItemNameTaken — đổi tên / bán lại bị chặn (operation: put)', () => {
  it('đổi tên bị chặn: món về tên và giá cũ qua restoreRow, sự kiện bảng khác còn nguyên', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const mId = await createItem({ name: 'Bánh bông lan', groupId: null, unit: 'Ly', unitPrice: 20_000, costPrice: null, isActive: 1 })
    await updateItem(mId, { name: 'Bánh flan' }) // put #1: đổi tên — đây là sự kiện bị từ chối
    const putRows = await outboxRowsOf('items', (await db.items.get(mId))!.gid)
    const renamePut = putRows.find((row) => row.operation === 'put')!
    await updateItem(mId, { unitPrice: 22_000 }) // put #2: đổi giá SAU đó, trên cùng món

    const otherId = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: otherId, name: 'Trà đá', unit: 'Ly', unitPrice: 3_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 3_000, method: 'cash', note: '' },
    })

    const outcome = await resolveItemNameTaken(renamePut, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    const restored = (await db.items.get(mId))!
    expect(restored.name).toBe('Bánh bông lan')
    expect(restored.unitPrice).toBe(20_000)
    // Chỉ hai `put` (đổi tên + đổi giá) bị hoàn lại; sự kiện `create` của M (đứng TRƯỚC renamePut) không
    // thuộc đuôi bị cuộn, vẫn còn nguyên để đẩy tiếp bình thường (tên gốc, vô hại).
    const remainingItemEvents = await outboxRowsOf('items', restored.gid)
    expect(remainingItemEvents).toHaveLength(1)
    expect(remainingItemEvents[0]!.operation).toBe('create')
    expect((await db.outbox.toArray()).filter((r) => r.table === 'orders')).toHaveLength(1)
    const sync = (await db.deviceState.get('sync')) as { resyncRequired?: boolean } | undefined
    expect(sync?.resyncRequired ?? false).toBe(false)
  })

  it('đổi tên bị chặn sau khi applier áp thay đổi từ xa: không ghi đè mù, resyncRequired=true', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const mId = await createItem({ name: 'Bánh bông lan', groupId: null, unit: 'Ly', unitPrice: 20_000, costPrice: null, isActive: 1 })
    const mGid = (await db.items.get(mId))!.gid
    await updateItem(mId, { name: 'Bánh flan' })
    const renamePut = (await outboxRowsOf('items', mGid)).find((row) => row.operation === 'put')!

    // Máy khác đổi giá món M và áp vào máy này qua applier TRƯỚC khi lượt nối chạy.
    await applyEvents(
      [
        {
          eventId: crypto.randomUUID(),
          txId: crypto.randomUUID(),
          txOrder: 0,
          seq: 2,
          deviceId: crypto.randomUUID(),
          serverAt: Date.now(),
          table: 'items',
          entityKey: mGid,
          entityGid: mGid,
          operation: 'put',
          before: null,
          after: { gid: mGid, name: 'Bánh bông lan', groupId: null, unit: 'Ly', unitPrice: 25_000, costPrice: null, isActive: 1, note: '', createdAt: 1, updatedAt: 2 },
          refs: { groupId: null },
        },
      ],
      leader,
    )

    const outcome = await resolveItemNameTaken(renamePut, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    const current = (await db.items.get(mId))!
    expect(current.unitPrice).toBe(25_000) // KHÔNG bị ghi đè mù bằng `before` (giá 20.000 cũ)
    const sync = (await db.deviceState.get('sync')) as { resyncRequired?: boolean } | undefined
    expect(sync?.resyncRequired).toBe(true)
    const notice = (await db.deviceState.get('notice')) as { message: string } | undefined
    expect(notice?.message).toContain('kéo lại sổ chung')
  })

  it('bán lại bị chặn: món về isActive 0, câu báo "Không bán lại được"', async () => {
    const existing = await seedExistingItem('Bánh flan', 15_000)
    const mId = await createItem({ name: 'Bánh cũ', groupId: null, unit: 'Ly', unitPrice: 10_000, costPrice: null, isActive: 0 })
    await updateItem(mId, { name: 'Bánh flan', isActive: 1 })
    const putRow = (await outboxRowsOf('items', (await db.items.get(mId))!.gid)).find((row) => row.operation === 'put')!

    const outcome = await resolveItemNameTaken(putRow, existing.gid, 'Bánh flan', leader)
    expect(outcome).toBe('resolved')

    const restored = (await db.items.get(mId))!
    expect(restored.isActive).toBe(0)
    const notice = (await db.deviceState.get('notice')) as { message: string } | undefined
    expect(notice?.message).toContain('Không bán lại được')
  })
})

describe('localId của sự kiện create (micro-test đầu phase)', () => {
  it('sự kiện create của bảng ++id (items) mang localId null trong outbox', async () => {
    const id = await createItem({ name: 'Bất kỳ', groupId: null, unit: 'Ly', unitPrice: 1_000, costPrice: null, isActive: 1 })
    const gid = (await db.items.get(id))!.gid
    const [createRow] = await outboxRowsOf('items', gid)
    expect(createRow!.localId).toBeNull()
  })
})
