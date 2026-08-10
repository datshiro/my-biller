import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectBackup, countAllRecords, replaceAllData, wipeAllData } from '../backup'
import { BillerDb, db } from '../db'
import { resetDbBlock } from '../db-block'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceConnection,
  getDeviceIdentity,
  savePairedDevice,
} from '../repositories/device-state'
import { createItem } from '../repositories/items'

const oldStores = {
  settings: 'key',
  itemGroups: '++id, name, sortOrder',
  items: '++id, name, groupId, isActive',
  customers: '++id, name, phone',
  orders: '++id, &code, customerId, soldAt, status',
  orderLines: '++id, orderId, itemId',
  payments: '++id, orderId, customerId, paidAt',
  expenseCategories: '++id, name',
  expenses: '++id, categoryId, spentAt',
}

const stamp = 123_456

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  resetDbBlock()
})

afterEach(() => resetDbBlock())

describe('nâng Dexie v2 lên schema hiện tại', () => {
  it('cấp gid cho đủ 9 bảng và giữ nguyên mọi mốc thời gian', async () => {
    const name = 'migration-v2-to-v3'
    await Dexie.delete(name)
    const old = new Dexie(name)
    old.version(1).stores(oldStores)
    old.version(2).stores({ customerPrices: '++id, &[customerId+itemId], customerId, itemId' })
    await old.open()

    await old.table('itemGroups').add({ id: 1, name: 'Món', sortOrder: 1, createdAt: 1, updatedAt: 2 })
    await old.table('items').add({ id: 1, name: 'Phở', groupId: 1, unit: 'tô', unitPrice: 50_000, costPrice: 20_000, isActive: 1, note: '', createdAt: 3, updatedAt: 4 })
    await old.table('customers').add({ id: 1, name: 'Hoa', phone: '', address: '', note: '', createdAt: 5, updatedAt: 6 })
    await old.table('customerPrices').add({ id: 1, customerId: 1, itemId: 1, unitPrice: 45_000, createdAt: 7, updatedAt: 8 })
    await old.table('orders').add({ id: 1, code: 'PBH-260809-001', customerId: 1, customerName: 'Hoa', subtotal: 50_000, discount: 0, surcharge: 0, total: 50_000, paidAmount: 50_000, status: 'paid', soldAt: stamp, note: '', createdAt: 9, updatedAt: 10 })
    await old.table('orderLines').add({ id: 1, orderId: 1, itemId: 1, name: 'Phở', unit: 'tô', unitPrice: 50_000, costPrice: 20_000, qty: 1, amount: 50_000 })
    await old.table('payments').add({ id: 1, orderId: 1, customerId: 1, amount: 50_000, method: 'cash', paidAt: stamp, note: '' })
    await old.table('expenseCategories').add({ id: 1, name: 'Chợ', createdAt: 11, updatedAt: 12 })
    await old.table('expenses').add({ id: 1, categoryId: 1, amount: 10_000, note: '', spentAt: stamp, createdAt: 13, updatedAt: 14 })
    old.close()

    const upgraded = new BillerDb(name)
    await upgraded.open()
    const tableNames = ['itemGroups', 'items', 'customers', 'customerPrices', 'orders', 'orderLines', 'payments', 'expenseCategories', 'expenses'] as const
    const rows = (await Promise.all(tableNames.map((table) => upgraded.table(table).toArray()))).flat()

    expect(rows).toHaveLength(9)
    expect(new Set(rows.map((row) => row.gid)).size).toBe(9)
    expect(await upgraded.itemGroups.get(1)).toMatchObject({ createdAt: 1, updatedAt: 2 })
    expect(await upgraded.items.get(1)).toMatchObject({ createdAt: 3, updatedAt: 4 })
    expect(await upgraded.customers.get(1)).toMatchObject({ createdAt: 5, updatedAt: 6 })
    expect(await upgraded.customerPrices.get(1)).toMatchObject({ createdAt: 7, updatedAt: 8 })
    expect(await upgraded.orders.get(1)).toMatchObject({ createdAt: 9, updatedAt: 10 })
    expect(await upgraded.expenseCategories.get(1)).toMatchObject({ createdAt: 11, updatedAt: 12 })
    expect(await upgraded.expenses.get(1)).toMatchObject({ createdAt: 13, updatedAt: 14 })
    expect(await upgraded.payments.get(1)).toMatchObject({ allocatedOrderId: 1 })
    expect(await upgraded.deviceState.get('schema')).toEqual({ key: 'schema', schemaGen: 5 })
    upgraded.close()
    await Dexie.delete(name)
  })
})

describe('deviceState nằm ngoài cuốn sổ', () => {
  it('không xuất ra file, chặn wipe/restore khi đã ghép và không được tính vào số dòng', async () => {
    const token = 'token-thu-nghiem-khong-duoc-ra-file-1234567890'
    const pairing = await beginDevicePairing()
    await savePairedDevice({
      pairingAttemptId: pairing.attemptId,
      admissionExpiresAt: Date.now() + 60_000,
      deviceId: '00000000-0000-4000-8000-000000000001',
      label: 'Quầy trước',
      letter: 'A',
      shopId: '00000000-0000-4000-8000-000000000002',
      token,
      syncUrl: 'https://sync.example.com',
    })
    await completeDevicePairing(pairing.attemptId)
    await createItem({ name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })
    const identity = await getDeviceIdentity()
    const connection = await getDeviceConnection()
    const file = await collectBackup(stamp)

    expect(JSON.stringify(file)).not.toContain('deviceState')
    expect(JSON.stringify(file)).not.toContain(identity?.deviceId)
    expect(JSON.stringify(file)).not.toContain(token)
    expect(await countAllRecords()).toBe(1)

    await expect(wipeAllData()).rejects.toThrow(/Máy đã ghép/)
    expect(await getDeviceIdentity()).toEqual(identity)
    expect(await getDeviceConnection()).toEqual(connection)
    expect(await countAllRecords()).toBe(1)
    await expect(replaceAllData(file.data)).rejects.toThrow(/Máy đã ghép/)
    expect(await getDeviceIdentity()).toEqual(identity)
    expect(await getDeviceConnection()).toEqual(connection)
    expect(await countAllRecords()).toBe(1)
  })
})

describe('schemaGen', () => {
  it('bundle hiện tại bị chặn khi kho có schema mới hơn dù không có tên bảng mới', async () => {
    const name = 'schema-gen-stale'
    await Dexie.delete(name)
    const current = new BillerDb(name)
    await current.open()
    current.close()

    const future = new Dexie(name)
    future
      .version(6)
      .stores({
        settings: 'key',
        deviceState: 'key',
        itemGroups: '++id, name, sortOrder, &gid',
        items: '++id, name, groupId, isActive, &gid',
        customers: '++id, name, phone, &gid',
        customerPrices: '++id, &[customerId+itemId], customerId, itemId, &gid',
        orders: '++id, &code, customerId, soldAt, status, &gid',
        orderLines: '++id, orderId, itemId, &gid',
        payments: '++id, orderId, customerId, paidAt, &gid, allocatedOrderId',
        expenseCategories: '++id, name, &gid',
        expenses: '++id, categoryId, spentAt, &gid',
        outbox: '++id, &eventId, txId, status, [txId+txOrder]',
      })
      .upgrade((transaction) => transaction.table('deviceState').put({ key: 'schema', schemaGen: 6 }))
    await future.open()
    expect(await future.table('deviceState').get('schema')).toEqual({ key: 'schema', schemaGen: 6 })
    future.close()

    const stale = new BillerDb(name)
    await expect(stale.open()).rejects.toThrow(/schema 6 > 5/)
    stale.close()
    await Dexie.delete(name)
  })
})
