import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { wipeAllData } from '../../backup'
import { db } from '../../db'
import {
  beginDevicePairing,
  cancelDevicePairing,
  completeDevicePairing,
  markDeviceRevoked,
  saveDeviceIdentity,
  savePairedDevice,
} from '../../repositories/device-state'
import { createGroup, createItem, deleteGroup, updateItem } from '../../repositories/items'
import { createOrder } from '../../repositories/orders'
import { requestFullResync } from '../applier'
import { safeParseLedgerPayload } from '@shared/ledger-schemas'

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

describe('outbox giao dịch', () => {
  it('khóa ghi suốt lượt ghép và từ chối lưu credential nếu replica đã đổi', async () => {
    await db.deviceState.delete('connection')
    const pairing = await beginDevicePairing()

    await expect(
      createItem({
        name: 'Món đua với lượt ghép',
        groupId: null,
        unit: 'phần',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
      }),
    ).rejects.toThrow(/đang ghép/)

    await db.settings.put({
      key: 'shop',
      value: { name: 'Đổi giữa lượt', phone: '', address: '', footerNote: '' },
    })
    await expect(
      savePairedDevice({
        pairingAttemptId: pairing.attemptId,
        admissionExpiresAt: Date.now() + 60_000,
        deviceId: crypto.randomUUID(),
        label: 'Quầy trước',
        letter: 'A',
        shopId: crypto.randomUUID(),
        token: 'n'.repeat(43),
        syncUrl: 'https://sync.example.com',
      }),
    ).rejects.toThrow(/đã đổi trong lúc ghép/)
    await cancelDevicePairing(pairing.attemptId)
  })

  it('chụp outbox seed bất biến trước khi mở khóa ghi cho máy vừa ghép', async () => {
    await db.deviceState.delete('connection')
    await db.outbox.clear()
    await createItem({
      name: 'Món có sẵn trước khi ghép',
      groupId: null,
      unit: 'phần',
      unitPrice: 10_000,
      costPrice: null,
      isActive: 1,
    })
    expect(await db.outbox.count()).toBe(0)

    const pairing = await beginDevicePairing()
    await savePairedDevice({
      pairingAttemptId: pairing.attemptId,
      admissionExpiresAt: Date.now() + 60_000,
      deviceId: crypto.randomUUID(),
      label: 'Quầy trước',
      letter: 'A',
      shopId: crypto.randomUUID(),
      token: 'n'.repeat(43),
      syncUrl: 'https://sync.example.com',
    })
    expect(await db.outbox.count()).toBe(pairing.localLedgerRows)
    await expect(
      createItem({
        name: 'Không chen vào snapshot seed',
        groupId: null,
        unit: 'phần',
        unitPrice: 20_000,
        costPrice: null,
        isActive: 1,
      }),
    ).rejects.toThrow(/đang ghép/)

    await completeDevicePairing(pairing.attemptId)
    expect(await db.outbox.count()).toBe(0)
  })

  it('ghi ảnh trước/sau cùng thay đổi và giữ eventId riêng với gid bản ghi', async () => {
    const id = await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    await updateItem(id, { unitPrice: 55_000 })

    const rows = await db.outbox.orderBy('id').toArray()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ table: 'items', operation: 'create', before: null })
    expect(rows[1]).toMatchObject({
      table: 'items',
      operation: 'put',
      before: { unitPrice: 50_000 },
      after: { unitPrice: 55_000 },
    })
    expect(rows[0]?.eventId).not.toBe(rows[1]?.eventId)
    expect(rows[0]?.entityGid).toBe(rows[1]?.entityGid)
  })

  it('mọi event của một lượt bán thật khớp schema payload trên Worker', async () => {
    await createOrder({
      customerId: null,
      customerName: 'Khách lẻ',
      lines: [
        {
          itemId: null,
          name: 'Trà đá',
          unit: 'ly',
          unitPrice: 3_000,
          costPrice: null,
          qty: 1,
        },
      ],
      discount: 0,
      surcharge: 0,
      soldAt: Date.now(),
      note: '',
      payment: { amount: 3_000, method: 'cash', note: '' },
    })

    const foreignKeys = new Set([
      'groupId',
      'customerId',
      'itemId',
      'orderId',
      'allocatedOrderId',
      'categoryId',
    ])
    const canonical = (payload: Record<string, unknown> | null) => {
      if (payload === null) return null
      return Object.fromEntries(Object.entries(payload).filter(([key]) => !foreignKeys.has(key)))
    }

    const rows = await db.outbox.orderBy('id').toArray()
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      for (const payload of [canonical(row.before), canonical(row.after)]) {
        if (payload === null) continue
        expect(
          safeParseLedgerPayload(row.table, payload).success,
          `${row.table}:${row.operation}`,
        ).toBe(true)
      }
    }
  })

  it('gom một lệnh một-với-N bằng cùng txId và chụp từng dòng', async () => {
    const groupId = await createGroup({ name: 'Món nước', sortOrder: 1 })
    await createItem({
      name: 'Cà phê',
      groupId,
      unit: 'ly',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
    })
    await createItem({
      name: 'Trà',
      groupId,
      unit: 'ly',
      unitPrice: 15_000,
      costPrice: null,
      isActive: 1,
    })
    await db.outbox.clear()

    await deleteGroup(groupId)
    const rows = (await db.outbox.toArray()).sort((left, right) => left.txOrder - right.txOrder)

    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row) => row.txId)).size).toBe(1)
    expect(rows.filter((row) => row.table === 'items')).toHaveLength(2)
    expect(rows.at(-1)).toMatchObject({ table: 'itemGroups', operation: 'delete', after: null })
  })

  it('wipe dữ liệu sổ bị chặn khi đã ghép và không xoá ledger, outbox hay danh tính máy', async () => {
    await createItem({
      name: 'Phở',
      groupId: null,
      unit: 'tô',
      unitPrice: 50_000,
      costPrice: null,
      isActive: 1,
    })
    const queued = await db.outbox.count()
    await expect(wipeAllData()).rejects.toThrow(/Máy đã ghép/)

    expect(queued).toBe(1)
    expect(await db.items.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    expect(await db.deviceState.get('connection')).toBeDefined()
  })

  it('khóa ghi mới ngay khi đã yêu cầu kéo lại toàn bộ sổ', async () => {
    await requestFullResync()

    await expect(
      createItem({
        name: 'Món không được chen vào lượt kéo lại',
        groupId: null,
        unit: 'phần',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
      }),
    ).rejects.toThrow(/đang kéo lại sổ chung/)

    expect(await db.items.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.deviceState.get('sync')).toMatchObject({ resyncRequired: true })
  })

  it('yêu cầu kéo lại và lệnh ghi đua nhau thì chỉ một transaction thắng', async () => {
    const [resync, write] = await Promise.allSettled([
      requestFullResync(),
      createItem({
        name: 'Món chạy đồng thời',
        groupId: null,
        unit: 'phần',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
      }),
    ])

    expect([resync, write].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const sync = await db.deviceState.get('sync')
    if (resync.status === 'fulfilled') {
      expect(write.status).toBe('rejected')
      expect(sync).toMatchObject({ resyncRequired: true })
      expect(await db.items.count()).toBe(0)
      expect(await db.outbox.count()).toBe(0)
    } else {
      expect(write.status).toBe('fulfilled')
      expect(sync).toMatchObject({ resyncRequired: false })
      expect(await db.items.count()).toBe(1)
      expect(await db.outbox.count()).toBe(1)
    }
  })

  it('máy bị thu hồi không tạo nhánh sổ cục bộ và chỉ mở lại sau khi ghép mới', async () => {
    await createItem({
      name: 'Món còn chờ trước khi bị thu hồi',
      groupId: null,
      unit: 'phần',
      unitPrice: 20_000,
      costPrice: null,
      isActive: 1,
    })
    const oldConnection = await db.deviceState.get('connection')
    await db.deviceState.put({
      key: 'sync',
      lastSeq: 42,
      revision: 3,
      resyncRequired: false,
      lastConnectedAt: 1,
    })
    await db.deviceState.put({
      key: 'lease',
      ownerId: crypto.randomUUID(),
      epoch: 2,
      expiresAt: Date.now() + 10_000,
    })
    await markDeviceRevoked()

    expect(await db.items.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)
    expect(await db.deviceState.get('writeBlock')).toMatchObject({
      reason: 'revoked',
      shopId: oldConnection?.key === 'connection' ? oldConnection.shopId : null,
    })

    await expect(
      createItem({
        name: 'Món không được ghi',
        groupId: null,
        unit: 'phần',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
      }),
    ).rejects.toThrow(/đã bị thu hồi/)
    expect(await db.items.count()).toBe(1)
    expect(await db.outbox.count()).toBe(1)

    const pairing = await beginDevicePairing()
    await savePairedDevice({
      pairingAttemptId: pairing.attemptId,
      admissionExpiresAt: Date.now() + 60_000,
      deviceId: crypto.randomUUID(),
      label: 'Quầy trước',
      letter: 'A',
      shopId: crypto.randomUUID(),
      token: 'n'.repeat(43),
      syncUrl: 'https://sync.example.com',
    })
    await completeDevicePairing(pairing.attemptId)
    expect(await db.items.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.deviceState.get('sync')).toMatchObject({
      lastSeq: 0,
      revision: 4,
      resyncRequired: false,
      lastConnectedAt: null,
    })
    expect(await db.deviceState.get('lease')).toBeUndefined()
    await expect(
      createItem({
        name: 'Món sau khi ghép lại',
        groupId: null,
        unit: 'phần',
        unitPrice: 10_000,
        costPrice: null,
        isActive: 1,
      }),
    ).resolves.toBeTypeOf('number')
    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
    expect(await db.deviceState.get('notice')).toBeUndefined()
  })
})
