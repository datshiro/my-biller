// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { planCatalogMigration, type MigrationGroup, type MigrationItem } from '@shared/catalog-migration'
import type { CatalogServerEvent } from '@shared/catalog-events'
import { projectLegacyMenu } from '@shared/legacy-menu'
import type { ServerEvent } from '@shared/sync-events'
import { db } from '../../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceSyncState,
  saveDeviceIdentity,
  savePairedDevice,
} from '../../repositories/device-state'
import { applyCatalogEvents, applyEvents } from '../applier'
import { claimLeadership } from '../leader'

const NOW = 1_700_000_000_000
const WORKER_DEVICE = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'
const TEA = '11111111-1111-4111-8111-111111111111'
const THACH = '22222222-2222-4222-8222-222222222222'

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

/** Đánh seq liên tục cho từng luồng như Worker: sổ chính và danh mục có hai dãy seq độc lập. */
function streams() {
  let mainSeq = 0
  let catalogSeq = 0
  const main = (
    table: ServerEvent['table'],
    entityKey: string,
    operation: ServerEvent['operation'],
    after: Record<string, unknown> | null,
    refs: Record<string, string | null> = {},
    before: Record<string, unknown> | null = null,
  ): ServerEvent => ({
    eventId: crypto.randomUUID(),
    txId: crypto.randomUUID(),
    txOrder: 0,
    table,
    entityKey,
    entityGid: entityKey,
    operation,
    before,
    after,
    refs,
    seq: ++mainSeq,
    deviceId: WORKER_DEVICE,
    serverAt: NOW,
  })
  const catalog = (
    entityKey: string,
    operation: CatalogServerEvent['operation'],
    after: Record<string, unknown> | null,
  ): CatalogServerEvent => ({
    eventId: crypto.randomUUID(),
    txId: crypto.randomUUID(),
    txOrder: 0,
    table: 'optionGroups',
    entityKey,
    entityGid: entityKey,
    operation,
    before: null,
    after,
    refs: {},
    seq: ++catalogSeq,
    deviceId: WORKER_DEVICE,
    serverAt: NOW,
  })
  return { main, catalog, mainCount: () => mainSeq, catalogCount: () => catalogSeq }
}

describe('áp event di trú menu cũ bằng đường áp của client', () => {
  it('máy cũ đã tạo nhóm có menu và một món sẵn có trùng tên topping: client áp đủ chuỗi và ra đúng trạng thái di trú', async () => {
    const legacyGroup = {
      gid: TEA,
      name: 'Trà sữa',
      sortOrder: 1,
      optionGroups: [
        { name: 'Đường', choices: ['Ít đường', 'Không đường'] },
        { name: 'Đá', choices: ['Đá chung', 'Đá riêng'] },
      ],
      toppingMenu: [
        { name: 'Trân châu', price: 5_000 },
        { name: 'Thạch', price: 3_000 },
      ],
      createdAt: 1,
      updatedAt: 1,
    }
    const existingThach = {
      gid: THACH,
      name: 'Thạch',
      unit: 'ly',
      unitPrice: 3_000,
      costPrice: null,
      isActive: 1,
      note: '',
      kind: 'item',
      createdAt: 1,
      updatedAt: 1,
    }
    const s = streams()
    const mainEvents: ServerEvent[] = [
      s.main('items', THACH, 'create', existingThach, { groupId: null }),
      s.main('itemGroups', TEA, 'create', legacyGroup),
    ]

    // Cùng hàm thuần mà Worker gọi: kế hoạch quyết định event nào được sinh ra và theo thứ tự nào.
    const plan = planCatalogMigration({
      groups: [legacyGroup as MigrationGroup],
      items: [{ ...existingThach, kind: 'item' } as MigrationItem],
      optionGroups: [],
      now: NOW,
    })
    for (const item of plan.createItems) mainEvents.push(s.main('items', item.gid, 'create', item, { groupId: null }))
    for (const gid of plan.markToppings) {
      mainEvents.push(
        s.main('items', gid, 'put', { ...existingThach, kind: 'topping', updatedAt: NOW }, { groupId: null }, existingThach),
      )
    }
    const catalogEvents = plan.createOptionGroups.map((group) => s.catalog(group.gid, 'create', group))
    const attached = plan.attach[0]!
    mainEvents.push(
      s.main('itemGroups', TEA, 'put', { ...legacyGroup, optionGroupGids: attached.optionGroupGids, updatedAt: NOW }, {}, legacyGroup),
    )

    // Chiếu theo phép chiếu của Worker: nhóm Đá là hằng có sẵn nên không di trú, trường cũ phải bỏ nó đi.
    const itemsAfter = [
      { gid: plan.createItems[0]!.gid, name: 'Trân châu', unitPrice: 5_000, isActive: 0, kind: 'topping' as const, createdAt: NOW },
      { gid: THACH, name: 'Thạch', unitPrice: 3_000, isActive: 1, kind: 'topping' as const, createdAt: 1 },
    ]
    const menu = projectLegacyMenu(attached.optionGroupGids, plan.createOptionGroups, itemsAfter)
    const attachedAfter = { ...legacyGroup, optionGroupGids: attached.optionGroupGids, updatedAt: NOW }
    mainEvents.push(s.main('itemGroups', TEA, 'put', { ...attachedAfter, ...menu, updatedAt: NOW }, {}, attachedAfter))

    await applyEvents(mainEvents, leader)
    await applyCatalogEvents(catalogEvents, leader)

    expect((await getDeviceSyncState()).lastSeq).toBe(s.mainCount())
    expect((await getDeviceSyncState()).catalogLastSeq).toBe(s.catalogCount())

    const trauChau = await db.items.where('gid').equals(plan.createItems[0]!.gid).first()
    expect(trauChau).toMatchObject({ name: 'Trân châu', kind: 'topping', isActive: 0, unitPrice: 5_000, groupId: null })
    const thach = await db.items.where('gid').equals(THACH).first()
    expect(thach).toMatchObject({ kind: 'topping', isActive: 1, unitPrice: 3_000, groupId: null })

    const groups = await db.optionGroups.toArray()
    expect(groups.map((group) => [group.kind, group.name]).sort()).toEqual([
      ['choice', 'Đường'],
      ['topping', 'Topping Trà sữa'],
    ])
    const toppingGroup = groups.find((group) => group.kind === 'topping')
    expect(toppingGroup).toMatchObject({
      toppings: [
        { itemGid: plan.createItems[0]!.gid, price: null },
        { itemGid: THACH, price: null },
      ],
    })

    const tea = await db.itemGroups.where('gid').equals(TEA).first()
    expect(tea?.optionGroupGids).toEqual(attached.optionGroupGids)
    expect(tea?.optionGroups).toEqual([{ name: 'Đường', choices: ['Ít đường', 'Không đường'] }])
    expect(tea?.toppingMenu).toEqual([
      { name: 'Trân châu', price: 5_000 },
      { name: 'Thạch', price: 3_000 },
    ])
  })

  it('áp lại chuỗi event đã áp: không ném, con trỏ không tiến, dữ liệu không đổi', async () => {
    const s = streams()
    const group = { gid: TEA, name: 'Trà sữa', sortOrder: 1, optionGroups: [], toppingMenu: [{ name: 'Trân châu', price: 5_000 }], createdAt: 1, updatedAt: 1 }
    const mainEvents = [s.main('itemGroups', TEA, 'create', group)]
    await applyEvents(mainEvents, leader)
    const before = await db.itemGroups.toArray()
    await expect(applyEvents(mainEvents, leader)).resolves.toBeUndefined()
    expect((await getDeviceSyncState()).lastSeq).toBe(1)
    expect(await db.itemGroups.toArray()).toEqual(before)
  })
})
