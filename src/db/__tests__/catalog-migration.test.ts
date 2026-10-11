import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { collectBackup, mergeAllDataAndRecalculate } from '../backup'
import { migrateLocalCatalog } from '../catalog-migration'
import { createGroup, createItem, updateGroup } from '../repositories/items'
import { beginDevicePairing, completeDevicePairing, savePairedDevice } from '../repositories/device-state'
import { applyBackup } from '@/features/settings/backup'
import { deterministicGid } from '@shared/catalog-migration'
import { installTestDevice } from '@/test-fixtures'
import type { BackupData } from '@/domain/schema'

const NOW = 1_800_000_000_000
const MENU = {
  optionGroups: [{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }],
  toppingMenu: [{ name: 'Trân châu', price: 5_000 }],
}

const rawGroups = () => db.itemGroups.toCollection().raw().toArray()

async function pairThisDevice(): Promise<void> {
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
}

/** Sổ như máy 2.19.0 để lại: nhóm có menu cũ, không có `optionGroupGids`, một món đang bán trùng tên topping. */
async function legacyShop() {
  const groupId = await createGroup({ name: 'Trà sữa', sortOrder: 1, ...MENU })
  const plainGroupId = await createGroup({ name: 'Đồ ăn', sortOrder: 2 })
  const pudding = await createItem({ name: 'Pudding', groupId: null, unit: 'phần', unitPrice: 8_000, costPrice: null, isActive: 1 })
  await updateGroup(plainGroupId, { toppingMenu: [{ name: 'pudding', price: 6_000 }] })
  return { groupId, plainGroupId, pudding }
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await installTestDevice()
})

describe('di trú menu cũ trên máy chưa ghép', () => {
  it('tạo món topping chỉ bán kèm, đánh dấu món trùng tên, gắn nhóm lựa chọn; không đi qua outbox', async () => {
    const { groupId, plainGroupId, pudding } = await legacyShop()
    const puddingBefore = await db.items.get(pudding)
    const outboxBefore = await db.outbox.count()

    expect(await migrateLocalCatalog(NOW)).toBe(true)

    const topping = await db.items.where('gid').equals(deterministicGid('topping:trân châu')).first()
    expect(topping).toMatchObject({ name: 'Trân châu', unitPrice: 5_000, isActive: 0, kind: 'topping', groupId: null })
    expect(await db.items.get(pudding)).toMatchObject({ kind: 'topping', isActive: 1, unitPrice: 8_000, updatedAt: NOW })
    expect(puddingBefore?.updatedAt).not.toBe(NOW)

    const optionGroups = await db.optionGroups.orderBy('sortOrder').toArray()
    expect(optionGroups.map((row) => [row.kind, row.name])).toEqual([
      ['choice', 'Đường'],
      ['topping', 'Topping Trà sữa'],
      ['topping', 'Topping Đồ ăn'],
    ])
    expect(optionGroups[2]).toMatchObject({ toppings: [{ price: 6_000 }] })
    expect((await db.itemGroups.get(groupId))?.optionGroupGids).toEqual([optionGroups[0]!.gid, optionGroups[1]!.gid])
    expect((await db.itemGroups.get(plainGroupId))?.optionGroupGids).toEqual([optionGroups[2]!.gid])
    // Trường cũ giữ nguyên.
    expect(await db.itemGroups.get(groupId)).toMatchObject(MENU)
    expect(await db.outbox.count()).toBe(outboxBefore)
  })

  it('chạy lại không đổi gì và không đóng dấu lại hàng không đụng tới', async () => {
    await legacyShop()
    const untouched = await createItem({ name: 'Phở', groupId: null, unit: 'tô', unitPrice: 50_000, costPrice: null, isActive: 1 })
    const stampBefore = (await db.items.get(untouched))?.updatedAt
    await migrateLocalCatalog(NOW)
    const snapshot = (await collectBackup(NOW)).data

    expect(await migrateLocalCatalog(NOW + 1)).toBe(false)
    expect((await collectBackup(NOW)).data).toEqual(snapshot)
    expect((await db.items.get(untouched))?.updatedAt).toBe(stampBefore)
  })

  it('chủ quán gỡ hết nhóm lựa chọn sau di trú: lần chạy sau không gắn lại', async () => {
    const { groupId } = await legacyShop()
    await migrateLocalCatalog(NOW)
    await updateGroup(groupId, { optionGroupGids: [] })

    expect(await migrateLocalCatalog(NOW + 1)).toBe(false)
    expect((await rawGroups()).find((row) => row.id === groupId)?.optionGroupGids).toEqual([])
  })

  it('máy đã ghép không tự di trú: sổ chung chỉ có một người ghi', async () => {
    await legacyShop()
    await pairThisDevice()
    expect(await migrateLocalCatalog(NOW)).toBe(false)
    expect(await db.optionGroups.count()).toBe(0)
    expect((await rawGroups()).every((row) => !('optionGroupGids' in row))).toBe(true)
  })
})

describe('di trú sau khôi phục và gộp sao lưu', () => {
  async function legacyFile(): Promise<BackupData> {
    await legacyShop()
    const data = (await collectBackup(NOW)).data
    await Promise.all(db.tables.filter((table) => table.name !== 'deviceState').map((table) => table.clear()))
    return data
  }

  it('Ghi đè bằng file chưa di trú: di trú chạy và báo cáo đối chiếu khớp', async () => {
    const file = await legacyFile()
    expect(file.optionGroups).toEqual([])

    const report = await applyBackup(file)

    expect(report?.ok).toBe(true)
    expect(await db.optionGroups.count()).toBe(3)
    expect(await db.items.where('gid').equals(deterministicGid('topping:trân châu')).count()).toBe(1)
    expect((await rawGroups()).filter((row) => row.optionGroupGids !== undefined)).toHaveLength(2)
  })

  it('Gộp file chưa di trú vào sổ đã di trú: không sinh trùng, kỳ vọng tính trên sổ đã di trú', async () => {
    const file = await legacyFile()
    await applyBackup(file)

    const { expected } = await mergeAllDataAndRecalculate(file, {}, [])

    expect(await db.optionGroups.count()).toBe(3)
    expect(await db.items.count()).toBe(2)
    expect(expected.data.optionGroups).toHaveLength(3)
    expect((await rawGroups()).filter((row) => row.optionGroupGids !== undefined)).toHaveLength(2)
  })
})
