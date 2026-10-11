// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceSyncState,
  saveDeviceIdentity,
  savePairedDevice,
} from '../../repositories/device-state'
import { createItem, updateItem } from '../../repositories/items'
import { createOptionGroup, updateOptionGroup, type OptionGroupInput } from '../../repositories/option-groups'
import { applyCatalogEvents, applyEvents, resetReadReplica } from '../applier'
import { pushCatalogEvent, pushEvent, SyncApiError } from '../client'
import { resolveItemNameTaken } from '../item-name-taken'
import { claimLeadership } from '../leader'
import { listPendingOutbox, stageExistingLedger, type OutboxRow } from '../outbox'
import { drainOutbox } from '../pusher'
import type { CatalogServerEvent } from '@shared/catalog-events'
import type { ServerEvent } from '@shared/sync-events'

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, pushEvent: vi.fn(), pushCatalogEvent: vi.fn() }
})

let leader: NonNullable<Awaited<ReturnType<typeof claimLeadership>>>

beforeEach(async () => {
  vi.mocked(pushEvent).mockReset().mockResolvedValue({ seq: 1, duplicate: false })
  vi.mocked(pushCatalogEvent).mockReset().mockResolvedValue({ seq: 1, duplicate: false })
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

const item = (name: string, kind: 'item' | 'topping' = 'item', isActive: 0 | 1 = 1) => ({
  name,
  groupId: null,
  unit: 'ly',
  unitPrice: 5_000,
  costPrice: null,
  isActive,
  kind,
})

const choiceInput: OptionGroupInput = {
  kind: 'choice',
  name: 'Đường',
  required: 0,
  maxSelect: 1,
  defaultChoice: null,
  sortOrder: 1,
  isActive: 1,
  choices: ['Ít', 'Vừa'],
}

const toppingInput = (itemGids: string[], maxSelect: number | null = null): OptionGroupInput => ({
  kind: 'topping',
  name: 'Topping',
  required: 0,
  maxSelect,
  defaultChoice: null,
  sortOrder: 2,
  isActive: 1,
  toppings: itemGids.map((itemGid) => ({ itemGid, price: null })),
})

const gidOfItem = async (id: number) => (await db.items.get(id))!.gid

const catalogServerEvent = (seq: number, after: Record<string, unknown> | null, entityKey = String(after?.gid)): CatalogServerEvent => ({
  eventId: crypto.randomUUID(),
  txId: crypto.randomUUID(),
  txOrder: 0,
  table: 'optionGroups',
  entityKey,
  entityGid: entityKey,
  operation: after ? 'put' : 'delete',
  before: after ? null : { ...choiceRow(entityKey) },
  after,
  refs: {},
  seq,
  deviceId: crypto.randomUUID(),
  serverAt: Date.now(),
})

const choiceRow = (gid: string, name = 'Đường') => ({
  gid,
  name,
  kind: 'choice',
  choices: ['Ít', 'Vừa'],
  required: 0,
  maxSelect: null,
  defaultChoice: null,
  sortOrder: 0,
  isActive: 1,
  createdAt: 1,
  updatedAt: 1,
})

describe('outbox luồng danh mục', () => {
  it('ghi nhóm lựa chọn qua syncTransaction thì outbox có dòng optionGroups không refs', async () => {
    const id = await createOptionGroup(choiceInput)
    await updateOptionGroup(id, { name: 'Đường mới' })
    const rows = await listPendingOutbox()
    expect(rows.map((row) => [row.table, row.operation])).toEqual([
      ['optionGroups', 'create'],
      ['optionGroups', 'put'],
    ])
    expect(rows[0]).toMatchObject({ refs: {}, entityGid: rows[0]?.entityKey })
    expect(rows[0]?.after).not.toHaveProperty('id')
  })

  it('máy đang kéo lại sổ chung thì không ghi được nhóm lựa chọn', async () => {
    const sync = await getDeviceSyncState()
    await db.deviceState.put({ ...sync, resyncRequired: true })
    await expect(createOptionGroup(choiceInput)).rejects.toThrow(/kéo lại sổ chung/)
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('nạp sổ lúc ghép xếp nhóm lựa chọn sau mọi bảng sổ chính', async () => {
    const toppingId = await createItem(item('Trân châu', 'topping'))
    await createOptionGroup(toppingInput([await gidOfItem(toppingId)]))
    const staged = await db.transaction('rw', [...db.tables], (transaction) => stageExistingLedger(transaction))
    const rows = await listPendingOutbox()
    expect(staged).toBe(rows.length)
    expect(rows.map((row) => row.table)).toEqual(['items', 'optionGroups'])
  })
})

describe('pusher hai luồng', () => {
  it('một hàng đợi theo id: dòng danh mục đi endpoint danh mục, giữ thứ tự với sổ chính', async () => {
    const calls: string[] = []
    vi.mocked(pushEvent).mockImplementation(async (_connection, _epoch, event) => {
      calls.push(`ledger:${event.table}`)
      return { seq: 1, duplicate: false }
    })
    vi.mocked(pushCatalogEvent).mockImplementation(async (_connection, _epoch, event) => {
      calls.push(`catalog:${event.table}`)
      return { seq: 1, duplicate: false }
    })
    const toppingId = await createItem(item('Trân châu', 'topping'))
    const groupId = await createOptionGroup(toppingInput([await gidOfItem(toppingId)]))
    const groupGid = (await db.optionGroups.get(groupId))!.gid
    await createItem({ ...item('Trà sữa'), optionGroupGids: [groupGid] } as never)

    const connection = (await db.deviceState.get('connection')) as never
    await drainOutbox(connection, leader)

    expect(calls).toEqual(['ledger:items', 'catalog:optionGroups', 'ledger:items'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('sổ chung từ chối nhóm lựa chọn thì hoàn lại nhóm và cả đuôi phía sau', async () => {
    vi.mocked(pushCatalogEvent).mockRejectedValue(new SyncApiError('Nhóm sai.', 'business-rejected', 409))
    await createOptionGroup(choiceInput)
    await createItem(item('Trà'))

    const connection = (await db.deviceState.get('connection')) as never
    await drainOutbox(connection, leader)

    expect(await db.optionGroups.count()).toBe(0)
    expect(await db.items.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(pushEvent).not.toHaveBeenCalled()
  })
})

describe('applier luồng danh mục', () => {
  it('áp theo catalogLastSeq riêng, không đụng lastSeq sổ chính, bỏ qua seq đã áp', async () => {
    const gid = crypto.randomUUID()
    await applyCatalogEvents([catalogServerEvent(1, choiceRow(gid)), catalogServerEvent(2, choiceRow(gid, 'Đường 2'))], leader)
    await applyCatalogEvents([catalogServerEvent(2, choiceRow(gid, 'Cũ'))], leader)

    const rows = await db.optionGroups.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ gid, name: 'Đường 2' })
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 0, catalogLastSeq: 2 })
    expect(await db.outbox.count()).toBe(0)

    await applyCatalogEvents([catalogServerEvent(3, null, gid)], leader)
    expect(await db.optionGroups.count()).toBe(0)
  })

  it('thiếu seq ở giữa thì từ chối cả lô và không tiến con trỏ', async () => {
    const gid = crypto.randomUUID()
    await expect(applyCatalogEvents([catalogServerEvent(2, choiceRow(gid))], leader)).rejects.toThrow(/Thiếu sự kiện danh mục/)
    expect(await db.optionGroups.count()).toBe(0)
    expect((await getDeviceSyncState()).catalogLastSeq).toBe(0)
  })

  it('hàng sync ghi trước khi có luồng danh mục đọc catalogLastSeq là 0', async () => {
    const legacy: Record<string, unknown> = { ...(await getDeviceSyncState()) }
    delete legacy.catalogLastSeq
    await db.deviceState.put(legacy as never)
    expect((await getDeviceSyncState()).catalogLastSeq).toBe(0)
  })

  it('kéo lại từ đầu xoá và đặt lại cả hai luồng', async () => {
    const gid = crypto.randomUUID()
    await applyCatalogEvents([catalogServerEvent(1, choiceRow(gid))], leader)
    const customerGid = crypto.randomUUID()
    const ledgerEvent: ServerEvent = {
      eventId: crypto.randomUUID(),
      txId: crypto.randomUUID(),
      txOrder: 0,
      table: 'customers',
      entityKey: customerGid,
      entityGid: customerGid,
      operation: 'create',
      before: null,
      after: { gid: customerGid, name: 'Hoa', phone: '', address: '', note: '', createdAt: 1, updatedAt: 1 },
      refs: {},
      seq: 1,
      deviceId: crypto.randomUUID(),
      serverAt: 1,
    }
    await applyEvents([ledgerEvent], leader)
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 1, catalogLastSeq: 1 })

    await resetReadReplica(leader)
    expect(await db.optionGroups.count()).toBe(0)
    expect(await db.customers.count()).toBe(0)
    expect(await getDeviceSyncState()).toMatchObject({ lastSeq: 0, catalogLastSeq: 0 })
  })
})

describe('nối món trùng tên với nhóm topping trong hàng đợi', () => {
  async function rejectedCreate(gid: string): Promise<OutboxRow> {
    const rows = await listPendingOutbox()
    return rows.find((row) => row.table === 'items' && row.entityKey === gid && row.operation === 'create')!
  }

  it('payload nhóm topping xếp sau create D được nối sang món có sẵn', async () => {
    const existingId = await createItem(item('Thạch', 'topping'))
    const existingGid = await gidOfItem(existingId)
    await db.outbox.clear()
    const dId = await createItem(item('Thạch ', 'topping'))
    const dGid = await gidOfItem(dId)
    await createOptionGroup(toppingInput([dGid]))

    expect(await resolveItemNameTaken(await rejectedCreate(dGid), existingGid, 'Thạch', leader)).toBe('resolved')

    const groupRow = (await listPendingOutbox()).find((row) => row.table === 'optionGroups')!
    expect((groupRow.after as { toppings: { itemGid: string }[] }).toppings.map((t) => t.itemGid)).toEqual([existingGid])
    const local = (await db.optionGroups.toArray())[0]!
    expect(local).toMatchObject({ toppings: [{ itemGid: existingGid, price: null }] })
    // Hàng cục bộ phải khớp `after` cuối: lệch `updatedAt` là lần cuộn ngược sau đó bị coi là xung đột.
    expect({ ...local, id: undefined }).toEqual({ ...groupRow.after, id: undefined })
  })

  it('món có sẵn không phải topping: gỡ khỏi payload, hạ maxSelect; nhóm rỗng thì tắt', async () => {
    const existingId = await createItem(item('Sữa'))
    const existingGid = await gidOfItem(existingId)
    const otherId = await createItem(item('Kem', 'topping'))
    const otherGid = await gidOfItem(otherId)
    await db.outbox.clear()
    const dId = await createItem(item('Sữa ', 'topping'))
    const dGid = await gidOfItem(dId)
    await createOptionGroup(toppingInput([dGid, otherGid], 2))
    await createOptionGroup({ ...toppingInput([dGid]), name: 'Chỉ D' })

    expect(await resolveItemNameTaken(await rejectedCreate(dGid), existingGid, 'Sữa', leader)).toBe('resolved')

    const groups = (await listPendingOutbox()).filter((row) => row.table === 'optionGroups').map((row) => row.after!)
    expect(groups[0]).toMatchObject({ toppings: [{ itemGid: otherGid, price: null }], maxSelect: 1, isActive: 1 })
    expect(groups[1]).toMatchObject({ toppings: [{ itemGid: dGid, price: null }], isActive: 0 })
  })

  it('món mới đang bán trùng tên món topping chỉ bán kèm: bật bán riêng và xếp lần bật vào hàng đợi', async () => {
    const hiddenId = await createItem(item('Trân châu', 'topping', 0))
    const hiddenGid = await gidOfItem(hiddenId)
    await db.outbox.clear()
    const dId = await createItem(item('Trân châu'))
    const dGid = await gidOfItem(dId)

    expect(await resolveItemNameTaken(await rejectedCreate(dGid), hiddenGid, 'Trân châu', leader)).toBe('resolved')

    expect(await db.items.get(hiddenId)).toMatchObject({ isActive: 1, kind: 'topping' })
    const rows = await listPendingOutbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ table: 'items', operation: 'put', entityKey: hiddenGid, refs: { groupId: null } })
    expect(rows[0]?.before).toMatchObject({ isActive: 0 })
    expect(rows[0]?.after).toMatchObject({ isActive: 1, kind: 'topping' })
    const notice = await db.deviceState.get('notice')
    expect(notice).toMatchObject({ message: expect.stringContaining('nay bán riêng được') })
  })

  it('món mới đã bị ngừng bán trước khi nối thì món topping chỉ bán kèm vẫn ẩn', async () => {
    const hiddenId = await createItem(item('Pudding', 'topping', 0))
    const hiddenGid = await gidOfItem(hiddenId)
    await db.outbox.clear()
    const dId = await createItem(item('Pudding'))
    const dGid = await gidOfItem(dId)
    await updateItem(dId, { isActive: 0 })

    expect(await resolveItemNameTaken(await rejectedCreate(dGid), hiddenGid, 'Pudding', leader)).toBe('resolved')

    expect(await db.items.get(hiddenId)).toMatchObject({ isActive: 0 })
    expect(await listPendingOutbox()).toHaveLength(0)
  })
})
