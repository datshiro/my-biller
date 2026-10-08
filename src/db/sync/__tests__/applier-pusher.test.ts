// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceConnection,
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
import { createOrder } from '../../repositories/orders'
import { SyncApiError } from '../client'
import { claimLeadership } from '../leader'
import { OUTBOX_CHANGED_EVENT, syncTransaction } from '../outbox'
import { drainOutbox, pushNext, rollbackRejectedTail } from '../pusher'
import type { ServerEvent } from '@shared/sync-events'

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, pushEvent: vi.fn() }
})

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

  it('hai lần đổi giá trong cùng một mili giây vẫn cuộn ngược về giá gốc', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    try {
      const id = await createItem({
        name: 'Phở',
        groupId: null,
        unit: 'tô',
        unitPrice: 50_000,
        costPrice: null,
        isActive: 1,
      })
      await db.outbox.clear()
      clock.mockReturnValue(1_800_000_000_002)
      await updateItem(id, { unitPrice: 55_000 })
      const rejected = (await db.outbox.orderBy('id').first())!
      await updateItem(id, { unitPrice: 60_000 })
      clock.mockReturnValue(1_800_000_000_004)

      await rollbackRejectedTail(rejected, leader, 'Máy chủ từ chối.')

      expect(await db.items.get(id)).toMatchObject({
        unitPrice: 50_000,
        updatedAt: 1_800_000_000_000,
      })
      expect(await db.deviceState.get('sync')).toMatchObject({ resyncRequired: false })
    } finally {
      clock.mockRestore()
    }
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

  it('một lần ghi 4 thay đổi, 2 đầu đã lên sổ chung rồi mới bị từ chối: câu nói đúng số đã hoàn lại, không đếm số đã lên', async () => {
    const stamp = Date.now()
    await syncTransaction(async () => {
      for (let i = 0; i < 4; i++) {
        await db.items.add({
          gid: crypto.randomUUID(),
          name: `Món ${i}`,
          groupId: null,
          unit: 'phần',
          unitPrice: 10_000,
          costPrice: null,
          isActive: 1,
          note: '',
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
    })
    const batch = await db.outbox.orderBy('id').toArray()
    expect(batch).toHaveLength(4)
    // 2 thay đổi đầu (txOrder 0, 1) coi như đã đẩy lên và được Worker nhận — xoá khỏi outbox cục bộ,
    // chỉ còn sống trên sổ chung. pushNext thử đẩy tiếp thay đổi thứ 3 (txOrder 2) thì bị từ chối.
    await db.outbox.bulkDelete([batch[0]!.id!, batch[1]!.id!])
    const rejected = batch[2]!

    await rollbackRejectedTail(rejected, leader, 'Thiếu bản ghi cha itemGroups.')

    expect(await db.outbox.count()).toBe(0)
    expect(await db.deviceState.get('notice')).toMatchObject({
      message:
        'Thiếu bản ghi cha itemGroups. Lần ghi này bị từ chối ở giữa: 2 thay đổi của nó đã được hoàn lại trên máy này; các thay đổi khác của lần ghi đó (nếu có) đã lên sổ chung.',
    })
  })

  it('cùng kịch bản nhưng có thêm một đơn làm sau: câu thêm "và 1 thao tác làm sau"', async () => {
    const stamp = Date.now()
    await syncTransaction(async () => {
      for (let i = 0; i < 4; i++) {
        await db.items.add({
          gid: crypto.randomUUID(),
          name: `Món ${i}`,
          groupId: null,
          unit: 'phần',
          unitPrice: 10_000,
          costPrice: null,
          isActive: 1,
          note: '',
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
    })
    const batch = await db.outbox.orderBy('id').toArray()
    await db.outbox.bulkDelete([batch[0]!.id!, batch[1]!.id!])
    const rejected = batch[2]!
    await createItem({ name: 'Làm sau', groupId: null, unit: 'phần', unitPrice: 5_000, costPrice: null, isActive: 1 })

    await rollbackRejectedTail(rejected, leader, 'Thiếu bản ghi cha itemGroups.')

    expect(await db.deviceState.get('notice')).toMatchObject({
      message: expect.stringContaining('và 1 thao tác làm sau'),
    })
  })
})

describe('pushNext — nối món khi sổ chung báo trùng tên', () => {
  it("pushEvent trả lỗi 'item-name-taken' với existingGid đã có trên máy thì nối rồi trả 'pushed'", async () => {
    const existingGid = crypto.randomUUID()
    await applyEvents(
      [
        {
          eventId: crypto.randomUUID(),
          txId: crypto.randomUUID(),
          txOrder: 0,
          seq: 1,
          deviceId: crypto.randomUUID(),
          serverAt: Date.now(),
          table: 'items',
          entityKey: existingGid,
          entityGid: existingGid,
          operation: 'create',
          before: null,
          after: {
            gid: existingGid,
            name: 'Trà đá',
            groupId: null,
            unit: 'Ly',
            unitPrice: 3_000,
            costPrice: null,
            isActive: 1,
            note: '',
            createdAt: 1,
            updatedAt: 1,
          },
          refs: { groupId: null },
        },
      ],
      leader,
    )
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_500, costPrice: null, isActive: 1 })
    const { pushEvent } = await import('../client')
    vi.mocked(pushEvent).mockRejectedValueOnce(
      new SyncApiError('trùng tên', 'item-name-taken', 409, { existingGid, existingName: 'Trà đá' }),
    )

    const connection = (await getDeviceConnection())!
    const outcome = await pushNext(connection, leader)
    expect(outcome).toBe('pushed')
    expect(await db.outbox.count()).toBe(0)
  })

  it("món có sẵn chưa về máy: trả 'empty', bắn OUTBOX_CHANGED_EVENT đúng một lần dù gọi hai lần", async () => {
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const { pushEvent } = await import('../client')
    const detail = { existingGid: crypto.randomUUID(), existingName: 'Trà đá' }
    vi.mocked(pushEvent).mockRejectedValue(new SyncApiError('trùng tên', 'item-name-taken', 409, detail))

    const events: Event[] = []
    const listener = (event: Event) => events.push(event)
    window.addEventListener(OUTBOX_CHANGED_EVENT, listener)
    try {
      const connection = (await getDeviceConnection())!
      expect(await pushNext(connection, leader)).toBe('empty')
      expect(await pushNext(connection, leader)).toBe('empty')
      expect(events).toHaveLength(1)
      expect(await db.outbox.count()).toBe(1) // 'deferred' không sửa gì
    } finally {
      window.removeEventListener(OUTBOX_CHANGED_EVENT, listener)
    }
  })

  it('phục hồi sau khi bị hoãn: dòng không liên quan phía sau vẫn đẩy đúng, đúng thứ tự cũ', async () => {
    const dId = await createItem({ name: 'Bánh flan', groupId: null, unit: 'Ly', unitPrice: 16_000, costPrice: null, isActive: 1 })
    const otherId = await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const order = await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [{ itemId: otherId, name: 'Trà đá', unit: 'Ly', unitPrice: 3_000, costPrice: null, qty: 1 }],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 3_000, method: 'cash', note: '' },
    })
    expect(order.id).toBeGreaterThan(0)
    const dGid = (await db.items.get(dId))!.gid
    const outboxBefore = await db.outbox.orderBy('id').toArray()
    expect(outboxBefore.length).toBeGreaterThan(1) // D đứng trước, các dòng của đơn đứng sau

    const { pushEvent } = await import('../client')
    vi.mocked(pushEvent).mockRejectedValue(
      new SyncApiError('trùng tên', 'item-name-taken', 409, {
        existingGid: crypto.randomUUID(),
        existingName: 'Bánh flan',
      }),
    )
    const connection = (await getDeviceConnection())!
    await drainOutbox(connection, leader)
    // Dừng ở D ('empty'): mọi dòng (kể cả không liên quan món) vẫn còn nguyên, đúng thứ tự.
    expect(await db.outbox.orderBy('id').toArray()).toEqual(outboxBefore)

    // Món có sẵn về máy.
    const existingGid = crypto.randomUUID()
    await applyEvents(
      [
        {
          eventId: crypto.randomUUID(),
          txId: crypto.randomUUID(),
          txOrder: 0,
          seq: 1,
          deviceId: crypto.randomUUID(),
          serverAt: Date.now(),
          table: 'items',
          entityKey: existingGid,
          entityGid: existingGid,
          operation: 'create',
          before: null,
          after: {
            gid: existingGid,
            name: 'Bánh flan',
            groupId: null,
            unit: 'Ly',
            unitPrice: 15_000,
            costPrice: null,
            isActive: 1,
            note: '',
            createdAt: 1,
            updatedAt: 1,
          },
          refs: { groupId: null },
        },
      ],
      leader,
    )
    vi.mocked(pushEvent).mockReset()
    vi.mocked(pushEvent).mockImplementation(async (_connection, _epoch, event) => {
      if (event.table === 'items' && event.entityKey === dGid) {
        throw new SyncApiError('trùng tên', 'item-name-taken', 409, { existingGid, existingName: 'Bánh flan' })
      }
      return { seq: 1, duplicate: false }
    })

    await drainOutbox(connection, leader)

    expect(await db.outbox.count()).toBe(0)
    // Dòng của đơn (không liên quan món) vẫn đẩy đúng, sau khi D đã được nối — không bị bỏ hay đẩy trước D.
    const pushedTables = vi.mocked(pushEvent).mock.calls.map(([, , event]) => event.table)
    expect(pushedTables).toContain('orders')
    expect(pushedTables).toContain('orderLines')
    expect(pushedTables).toContain('payments')
  })

  it('phản hồi item-name-taken thiếu existingGid/existingName thì coi như deferred, không đoán mò nối sai', async () => {
    await createItem({ name: 'Trà đá', groupId: null, unit: 'Ly', unitPrice: 3_000, costPrice: null, isActive: 1 })
    const { pushEvent } = await import('../client')
    vi.mocked(pushEvent).mockRejectedValueOnce(
      new SyncApiError('trùng tên', 'item-name-taken', 409, { message: 'thiếu existingGid' }),
    )

    const connection = (await getDeviceConnection())!
    expect(await pushNext(connection, leader)).toBe('empty')
    expect(await db.outbox.count()).toBe(1)
  })
})
