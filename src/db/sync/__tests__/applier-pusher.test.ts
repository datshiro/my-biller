import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceSyncState,
  saveDeviceIdentity,
  savePairedDevice,
} from '../../repositories/device-state'
import {
  createGroup,
  createItem,
  deleteGroup,
  deleteItem,
  updateItem,
} from '../../repositories/items'
import { applyEvents } from '../applier'
import { claimLeadership } from '../leader'
import { rollbackRejectedTail } from '../pusher'
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

describe('applier', () => {
  it('áp lại cùng lô không nhân đôi và đổi foreign key gid sang id cục bộ', async () => {
    const customerGid = crypto.randomUUID()
    const orderGid = crypto.randomUUID()
    const base = {
      txId: crypto.randomUUID(),
      txOrder: 0,
      operation: 'create' as const,
      before: null,
      deviceId: crypto.randomUUID(),
      serverAt: Date.now(),
    }
    const events: ServerEvent[] = [
      {
        ...base,
        seq: 1,
        eventId: crypto.randomUUID(),
        table: 'customers',
        entityKey: customerGid,
        entityGid: customerGid,
        after: {
          gid: customerGid,
          name: 'Hoa',
          phone: '',
          address: '',
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
        refs: {},
      },
      {
        ...base,
        seq: 2,
        txOrder: 1,
        eventId: crypto.randomUUID(),
        table: 'orders',
        entityKey: orderGid,
        entityGid: orderGid,
        after: {
          gid: orderGid,
          code: 'PBH-260809-B001',
          originalCode: '',
          customerId: 999,
          customerName: 'Hoa',
          subtotal: 10_000,
          discount: 0,
          surcharge: 0,
          total: 10_000,
          paidAmount: 0,
          status: 'unpaid',
          soldAt: 1,
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
        refs: { customerId: customerGid },
      },
    ]

    await applyEvents(events, leader)
    const revisionAfterFirstApply = (await getDeviceSyncState()).revision
    await applyEvents(events, leader)

    const customer = await db.customers.where('gid').equals(customerGid).first()
    const order = await db.orders.where('gid').equals(orderGid).first()
    expect(await db.customers.count()).toBe(1)
    expect(await db.orders.count()).toBe(1)
    expect(order?.customerId).toBe(customer?.id)
    expect((await db.deviceState.get('sync'))).toMatchObject({
      lastSeq: 2,
      revision: revisionAfterFirstApply,
    })
  })

  it('từ chối nguyên lô khi sổ chung trả về payload sai và không tiến con trỏ', async () => {
    const base = {
      txId: crypto.randomUUID(),
      txOrder: 0,
      operation: 'create' as const,
      before: null,
      deviceId: crypto.randomUUID(),
      serverAt: Date.now(),
    }
    const customerGid = crypto.randomUUID()
    const expenseGid = crypto.randomUUID()
    const events: ServerEvent[] = [
      {
        ...base,
        seq: 1,
        eventId: crypto.randomUUID(),
        table: 'customers',
        entityKey: customerGid,
        entityGid: customerGid,
        after: {
          gid: customerGid,
          name: 'Hoa',
          phone: '',
          address: '',
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
        refs: {},
      },
      {
        ...base,
        seq: 2,
        txOrder: 1,
        eventId: crypto.randomUUID(),
        table: 'expenses',
        entityKey: expenseGid,
        entityGid: expenseGid,
        after: {
          gid: expenseGid,
          amount: 10_000.5,
          note: '',
          spentAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        refs: { categoryId: null },
      },
    ]

    await expect(applyEvents(events, leader)).rejects.toThrow(/expenses.*không hợp lệ/)
    expect(await db.customers.count()).toBe(0)
    expect(await db.expenses.count()).toBe(0)
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 0 })
  })

  it('từ chối sự kiện thiếu liên kết cục bộ bắt buộc thay vì ghi dòng khuyết', async () => {
    const itemGid = crypto.randomUUID()
    const invalid: ServerEvent = {
      seq: 1,
      eventId: crypto.randomUUID(),
      txId: crypto.randomUUID(),
      txOrder: 0,
      table: 'items',
      entityKey: itemGid,
      entityGid: itemGid,
      operation: 'create',
      before: null,
      after: {
        gid: itemGid,
        name: 'Trà',
        unit: 'ly',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
        note: '',
        createdAt: 1,
        updatedAt: 1,
      },
      refs: {},
      deviceId: crypto.randomUUID(),
      serverAt: Date.now(),
    }

    await expect(applyEvents([invalid], leader)).rejects.toThrow(/items.*không hợp lệ/)
    expect(await db.items.count()).toBe(0)
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 0 })
  })

  it('batch đã tải dưới leader cũ không commit và không đụng outbox sau takeover', async () => {
    await createItem({
      name: 'Món còn chờ leader mới',
      groupId: null,
      unit: 'phần',
      unitPrice: 10_000,
      costPrice: null,
      isActive: 1,
    })
    const pendingBefore = await db.outbox.toArray()
    const currentLease = await db.deviceState.get('lease')
    if (currentLease?.key !== 'lease') throw new Error('Thiếu lease của leader cũ trong test.')
    await db.deviceState.put({ ...currentLease, expiresAt: 0 })
    const replacement = await claimLeadership(db, crypto.randomUUID(), Date.now())
    expect(replacement?.epoch).toBeGreaterThan(leader.epoch)

    const customerGid = crypto.randomUUID()
    const staleBatch: ServerEvent[] = [
      {
        seq: 1,
        eventId: crypto.randomUUID(),
        txId: crypto.randomUUID(),
        txOrder: 0,
        table: 'customers',
        entityKey: customerGid,
        entityGid: customerGid,
        operation: 'create',
        before: null,
        after: {
          gid: customerGid,
          name: 'Hoa',
          phone: '',
          address: '',
          note: '',
          createdAt: 1,
          updatedAt: 1,
        },
        refs: {},
        deviceId: crypto.randomUUID(),
        serverAt: Date.now(),
      },
    ]

    await expect(applyEvents(staleBatch, leader)).rejects.toThrow(/stale-leader/)
    expect(await db.customers.count()).toBe(0)
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 0 })
    expect(await db.outbox.toArray()).toEqual(pendingBefore)
  })
})

describe('rollback từ chối nghiệp vụ', () => {
  it('bỏ dòng vừa tạo khi máy chủ từ chối lệnh thêm mới', async () => {
    const id = await createItem({
      name: 'Món mới',
      groupId: null,
      unit: 'phần',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    const rejected = (await db.outbox.toArray())[0]!

    await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

    expect(await db.items.get(id)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('khôi phục ảnh trước của lệnh sửa và bỏ cả đuôi outbox', async () => {
    const id = await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    await db.outbox.clear()
    await updateItem(id, { unitPrice: 55_000 })
    const rejected = (await db.outbox.toArray())[0]!

    await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

    expect(await db.items.get(id)).toMatchObject({ unitPrice: 50_000 })
    expect(await db.outbox.count()).toBe(0)
    expect(await db.deviceState.get('notice')).toMatchObject({ key: 'notice' })
  })

  it('khôi phục dòng vừa xoá khi máy chủ từ chối lệnh xoá', async () => {
    const id = await createItem({
      name: 'Món chưa bán',
      groupId: null,
      unit: 'phần',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    const before = await db.items.get(id)
    await db.outbox.clear()
    await deleteItem(id)
    const rejected = (await db.outbox.toArray())[0]!

    await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

    expect(await db.items.get(id)).toEqual(before)
    expect(await db.outbox.count()).toBe(0)
  })

  it('cuộn ngược trọn lệnh một-với-N theo thứ tự ngược', async () => {
    const groupId = await createGroup({ name: 'Món nước', sortOrder: 1 })
    const firstId = await createItem({
      name: 'Cà phê',
      groupId,
      unit: 'ly',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
    })
    const secondId = await createItem({
      name: 'Trà',
      groupId,
      unit: 'ly',
      unitPrice: 15_000,
      costPrice: null,
      isActive: 1,
    })
    await db.outbox.clear()
    await deleteGroup(groupId)
    const tail = await db.outbox.orderBy('id').toArray()

    expect(tail).toHaveLength(3)
    await rollbackRejectedTail(tail[0]!, leader, 'Máy chủ từ chối.')

    expect(await db.itemGroups.get(groupId)).toMatchObject({ name: 'Món nước' })
    expect(await db.items.get(firstId)).toMatchObject({ groupId })
    expect(await db.items.get(secondId)).toMatchObject({ groupId })
    expect(await db.outbox.count()).toBe(0)
  })

  it('từ chối nhóm cũ thì cuộn ngược cả hai thao tác làm sau', async () => {
    const id = await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    await db.outbox.clear()
    await updateItem(id, { unitPrice: 55_000 })
    const rejected = (await db.outbox.orderBy('id').first())!
    await updateItem(id, { unitPrice: 60_000 })
    const laterId = await createItem({
      name: 'Món làm sau',
      groupId: null,
      unit: 'phần',
      unitPrice: 10_000,
      costPrice: null,
      isActive: 1,
    })
    const tail = await db.outbox.orderBy('id').toArray()
    expect(tail).toHaveLength(3)
    expect(tail[0]).toMatchObject({ before: { unitPrice: 50_000 }, after: { unitPrice: 55_000 } })
    expect(tail[1]).toMatchObject({ before: { unitPrice: 55_000 }, after: { unitPrice: 60_000 } })

    await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

    expect(await db.items.get(id)).toMatchObject({ unitPrice: 50_000 })
    expect(await db.items.get(laterId)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
    expect(await db.deviceState.get('notice')).toMatchObject({
      message: expect.stringContaining('2 thao tác làm sau'),
    })
  })

  it('không dán before đè thay đổi mới và đánh dấu kéo lại từ đầu', async () => {
    const id = await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    await db.outbox.clear()
    await updateItem(id, { unitPrice: 55_000 })
    const rejected = (await db.outbox.toArray())[0]!
    await db.items.update(id, { unitPrice: 60_000 })

    await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

    expect(await db.items.get(id)).toMatchObject({ unitPrice: 60_000 })
    expect(await db.deviceState.get('sync')).toMatchObject({ resyncRequired: true })
  })
})
