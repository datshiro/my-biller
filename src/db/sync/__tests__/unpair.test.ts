import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRestoreBlock, wipeAllData } from '../../backup'
import { db } from '../../db'
import {
  beginDevicePairing,
  cancelDevicePairing,
  completeDevicePairing,
  getDeviceConnection,
  getDevicePairingState,
  getDeviceSyncState,
  leaveSharedLedger,
  markDeviceRevoked,
  saveDeviceIdentity,
  saveDeviceNotice,
  savePairedDevice,
} from '../../repositories/device-state'
import { createItem } from '../../repositories/items'
import { createOrder } from '../../repositories/orders'
import { listShopDevices, revokeShopDevice, SyncApiError } from '../client'
import { UnpairBlockedError, UnpairUncertainError, unpairThisDevice } from '../unpair'

vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client')>()),
  listShopDevices: vi.fn(),
  revokeShopDevice: vi.fn(),
}))

const TOKEN = 't'.repeat(43)
const currentDevice = {
  id: 'srv-a',
  letter: 'A',
  label: 'Quầy trước',
  createdAt: 1,
  revokedAt: null,
  current: true,
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

function addItem(name: string): Promise<number> {
  return createItem({
    name,
    groupId: null,
    unit: 'phần',
    unitPrice: 10_000,
    costPrice: null,
    isActive: 1,
  })
}

function recordSale(): Promise<{ id: number; code: string }> {
  return createOrder({
    customerId: null,
    customerName: 'Khách lẻ',
    lines: [{ itemId: null, name: 'Trà đá', unit: 'ly', unitPrice: 3_000, costPrice: null, qty: 2 }],
    discount: 0,
    surcharge: 0,
    soldAt: Date.now(),
    note: '',
    payment: { amount: 6_000, method: 'cash', note: '' },
  })
}

async function seedLedgerAndDrainOutbox(): Promise<void> {
  await addItem('Phở')
  await recordSale()
  await db.outbox.clear()
}

async function ledgerSnapshot() {
  const [items, orders, orderLines, payments] = await Promise.all([
    db.items.toArray(),
    db.orders.toArray(),
    db.orderLines.toArray(),
    db.payments.toArray(),
  ])
  return {
    counts: {
      items: items.length,
      orders: orders.length,
      orderLines: orderLines.length,
      payments: payments.length,
    },
    paymentAmountSum: payments.reduce((total, payment) => total + payment.amount, 0),
    orderTotalSum: orders.reduce((total, order) => total + order.total, 0),
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (caught) {
    return caught
  }
  throw new Error('Promise không ném lỗi như kỳ vọng')
}

async function expirePairingLock(patch: { connectionSaved?: boolean } = {}): Promise<void> {
  const pairing = await getDevicePairingState()
  if (!pairing) throw new Error('Chưa có khoá ghép.')
  await db.deviceState.put({ ...pairing, ...patch, expiresAt: Date.now() - 1 })
}

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
    token: TOKEN,
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)

  setOnline(true)
  vi.mocked(listShopDevices).mockReset()
  vi.mocked(listShopDevices).mockResolvedValue({ devices: [currentDevice], latestSeq: 0 })
  vi.mocked(revokeShopDevice).mockReset()
  vi.mocked(revokeShopDevice).mockResolvedValue({ revoked: true, deviceId: 'srv-a' })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine')
})

describe('rời sổ chung về sổ cục bộ', () => {
  it('huỷ ghép giữ nguyên số dòng và tổng tiền của sổ, chỉ gỡ khoá đồng bộ', async () => {
    await seedLedgerAndDrainOutbox()
    await db.deviceState.put({
      key: 'lease',
      ownerId: crypto.randomUUID(),
      epoch: 2,
      expiresAt: Date.now() + 10_000,
    })
    await saveDeviceNotice('Thông báo cũ của máy đang ghép')
    const before = await ledgerSnapshot()
    const syncBefore = await getDeviceSyncState()
    await db.deviceState.put({ ...syncBefore, lastSeq: 7 })

    await leaveSharedLedger({ kind: 'connected', token: TOKEN })

    const after = await ledgerSnapshot()
    expect(before.paymentAmountSum).toBe(6_000)
    expect(after).toEqual(before)
    expect(await db.deviceState.get('identity')).toMatchObject({ label: 'Quầy trước', letter: 'A' })
    for (const key of ['connection', 'lease', 'pairing', 'notice', 'writeBlock'] as const) {
      expect(await db.deviceState.get(key)).toBeUndefined()
    }
    expect(await getDeviceSyncState()).toMatchObject({
      lastSeq: 0,
      resyncRequired: false,
      revision: syncBefore.revision + 1,
      lastConnectedAt: null,
    })
  })

  it('sau khi huỷ ghép máy chưa ghép ghi được sổ mới và không bị chặn sao lưu hay xoá', async () => {
    await seedLedgerAndDrainOutbox()

    await leaveSharedLedger({ kind: 'connected', token: TOKEN })

    expect(await getRestoreBlock()).toBeNull()
    await expect(addItem('Bún')).resolves.toBeTypeOf('number')
    expect(await db.outbox.count()).toBe(0)
    await expect(wipeAllData()).resolves.toBeUndefined()
  })

  it('hàng đợi còn giao dịch chưa đẩy bị bỏ và báo đúng số giao dịch', async () => {
    await addItem('Phở')
    await addItem('Bún')
    expect(await db.outbox.count()).toBe(2)

    await expect(leaveSharedLedger({ kind: 'connected', token: TOKEN })).resolves.toEqual({
      droppedOperations: 2,
    })

    expect(await db.outbox.count()).toBe(0)
    expect(await db.items.count()).toBe(2)
  })

  it('máy bị thu hồi rời về sổ cục bộ, giữ sổ và gỡ cảnh báo thu hồi', async () => {
    await addItem('Phở')
    await markDeviceRevoked()
    expect(await getRestoreBlock()).toBe('revoked')

    await expect(leaveSharedLedger({ kind: 'revoked' })).resolves.toEqual({ droppedOperations: 1 })

    expect(await db.items.count()).toBe(1)
    expect(await getRestoreBlock()).toBeNull()
    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
    expect(await db.deviceState.get('notice')).toBeUndefined()
  })

  it('rời sổ kiểu máy bị thu hồi khi máy còn ghép thì ném và không đổi gì', async () => {
    await addItem('Phở')
    const before = await db.deviceState.toArray()

    await expect(leaveSharedLedger({ kind: 'revoked' })).rejects.toThrow(
      /Trạng thái ghép của máy vừa đổi/,
    )

    expect(await db.deviceState.toArray()).toEqual(before)
    expect(await db.outbox.count()).toBe(1)
  })

  it('cảnh báo thu hồi với token của máy đã rời sổ không ghi gì lên máy', async () => {
    await seedLedgerAndDrainOutbox()
    await leaveSharedLedger({ kind: 'connected', token: TOKEN })

    await markDeviceRevoked(TOKEN)

    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
    expect(await db.deviceState.get('notice')).toBeUndefined()
  })

  it('cảnh báo thu hồi với token khác không đụng tới máy đang ghép', async () => {
    await markDeviceRevoked('x'.repeat(43))

    expect(await getDeviceConnection()).toBeDefined()
    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
    expect(await db.deviceState.get('notice')).toBeUndefined()
  })

  it('thu hồi không kèm token vẫn ghi cảnh báo và gỡ kết nối như trước', async () => {
    await markDeviceRevoked()

    expect(await getDeviceConnection()).toBeUndefined()
    expect(await db.deviceState.get('writeBlock')).toMatchObject({ reason: 'revoked' })
  })

  it('khoá ghép còn hiệu lực chặn rời sổ và không đổi trạng thái', async () => {
    await beginDevicePairing()
    const before = await db.deviceState.toArray()

    await expect(leaveSharedLedger({ kind: 'connected', token: TOKEN })).rejects.toThrow(/đang ghép/)

    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('khoá ghép đã lưu kết nối chặn rời sổ dù khoá đã hết hạn', async () => {
    await beginDevicePairing()
    await expirePairingLock({ connectionSaved: true })
    const before = await db.deviceState.toArray()

    await expect(leaveSharedLedger({ kind: 'connected', token: TOKEN })).rejects.toThrow(/đang ghép/)

    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('máy bị thu hồi có khoá ghép hết hạn vẫn rời về sổ cục bộ và gỡ khoá đó', async () => {
    await markDeviceRevoked()
    await beginDevicePairing()
    await expirePairingLock()

    await leaveSharedLedger({ kind: 'revoked' })

    expect(await db.deviceState.get('pairing')).toBeUndefined()
    expect(await getRestoreBlock()).toBeNull()
  })

  it('token không khớp với ghép hiện tại thì không rời sổ', async () => {
    await seedLedgerAndDrainOutbox()
    await addItem('Bún')
    const before = await db.deviceState.toArray()
    const outboxBefore = await db.outbox.count()

    await expect(leaveSharedLedger({ kind: 'connected', token: 'x'.repeat(43) })).rejects.toThrow(
      /Trạng thái ghép của máy vừa đổi/,
    )

    expect(await db.deviceState.toArray()).toEqual(before)
    expect(await db.outbox.count()).toBe(outboxBefore)
  })

  it('thu hồi xảy ra trước lệnh rời sổ với đúng token vẫn cho rời sổ', async () => {
    await addItem('Phở')
    await markDeviceRevoked(TOKEN)

    await expect(leaveSharedLedger({ kind: 'connected', token: TOKEN })).resolves.toEqual({
      droppedOperations: 1,
    })

    expect(await db.deviceState.get('writeBlock')).toBeUndefined()
    expect(await getRestoreBlock()).toBeNull()
  })

  it('ghép lại sau khi huỷ ghép báo máy còn sổ cục bộ', async () => {
    await seedLedgerAndDrainOutbox()
    await leaveSharedLedger({ kind: 'connected', token: TOKEN })

    const pairing = await beginDevicePairing()

    expect(pairing).toMatchObject({ hasLocalLedger: true })
    expect(pairing.localLedgerRows).toBeGreaterThan(0)
    await cancelDevicePairing(pairing.attemptId)
  })
})

describe('huỷ ghép máy này', () => {
  it('đủ điều kiện thì thu hồi máy này trên sổ chung rồi về sổ cục bộ', async () => {
    const connection = await getDeviceConnection()

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(listShopDevices).toHaveBeenCalledWith(connection, {
      signal: expect.any(AbortSignal),
    })
    expect(revokeShopDevice).toHaveBeenCalledWith(connection, 'srv-a', {
      signal: expect.any(AbortSignal),
    })
    expect(await getDeviceConnection()).toBeUndefined()
    expect(await getRestoreBlock()).toBeNull()
  })

  it('mất mạng thì chặn trước mọi lệnh gọi sổ chung', async () => {
    setOnline(false)
    const before = await db.deviceState.toArray()

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'offline' })
    expect(listShopDevices).not.toHaveBeenCalled()
    expect(revokeShopDevice).not.toHaveBeenCalled()
    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('còn khoá ghép thì chặn trước mọi lệnh gọi sổ chung', async () => {
    await beginDevicePairing()
    const before = await db.deviceState.toArray()

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'pairing' })
    expect(listShopDevices).not.toHaveBeenCalled()
    expect(revokeShopDevice).not.toHaveBeenCalled()
    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('còn giao dịch chưa đẩy thì chặn và báo số giao dịch', async () => {
    await addItem('Phở')
    const before = await db.deviceState.toArray()

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'pending', pending: 1 })
    expect(listShopDevices).not.toHaveBeenCalled()
    expect(revokeShopDevice).not.toHaveBeenCalled()
    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('bản sao đang kéo lại thì chặn trước mọi lệnh gọi sổ chung', async () => {
    await db.deviceState.put({ ...(await getDeviceSyncState()), resyncRequired: true })
    const before = await db.deviceState.toArray()

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'resync' })
    expect(listShopDevices).not.toHaveBeenCalled()
    expect(revokeShopDevice).not.toHaveBeenCalled()
    expect(await db.deviceState.toArray()).toEqual(before)
  })

  it('bản sao tụt sau sổ chung thì chặn và không thu hồi', async () => {
    vi.mocked(listShopDevices).mockResolvedValue({ devices: [currentDevice], latestSeq: 5 })
    await db.deviceState.put({ ...(await getDeviceSyncState()), lastSeq: 3 })

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'behind' })
    expect(revokeShopDevice).not.toHaveBeenCalled()
  })

  it('Worker không trả latestSeq thì không chặn vì tụt sau', async () => {
    vi.mocked(listShopDevices).mockResolvedValue({ devices: [currentDevice] })
    await db.deviceState.put({ ...(await getDeviceSyncState()), lastSeq: 3 })

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(revokeShopDevice).toHaveBeenCalledTimes(1)
  })

  it('không tìm thấy chính máy này trong danh sách máy thì chặn', async () => {
    vi.mocked(listShopDevices).mockResolvedValue({
      devices: [{ ...currentDevice, current: false }],
      latestSeq: 0,
    })

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairBlockedError)
    expect(error).toMatchObject({ reason: 'unknown-device' })
    expect(revokeShopDevice).not.toHaveBeenCalled()
  })

  it('danh sách máy báo 401 thì coi như đã bị thu hồi và về sổ cục bộ', async () => {
    vi.mocked(listShopDevices).mockRejectedValue(new SyncApiError('x', 'unauthorized', 401))

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(revokeShopDevice).not.toHaveBeenCalled()
    expect(await getDeviceConnection()).toBeUndefined()
  })

  it('lệnh thu hồi báo 401 thì về sổ cục bộ', async () => {
    vi.mocked(revokeShopDevice).mockRejectedValue(new SyncApiError('x', 'unauthorized', 401))

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(await getDeviceConnection()).toBeUndefined()
  })

  it('mất response sau lệnh thu hồi nhưng hỏi lại thấy máy đã bị thu hồi thì về sổ cục bộ', async () => {
    vi.mocked(revokeShopDevice).mockRejectedValue(new SyncApiError('x', 'network', 0))
    vi.mocked(listShopDevices)
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
      .mockRejectedValueOnce(new SyncApiError('x', 'unauthorized', 401))

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(await getDeviceConnection()).toBeUndefined()
  })

  it('mất response và hỏi lại thấy máy còn sống thì ném lại lỗi mạng và giữ nguyên ghép', async () => {
    const networkError = new SyncApiError('x', 'network', 0)
    vi.mocked(revokeShopDevice).mockRejectedValue(networkError)
    vi.mocked(listShopDevices)
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
    const before = await db.deviceState.toArray()

    await expect(unpairThisDevice()).rejects.toBe(networkError)

    expect(listShopDevices).toHaveBeenCalledTimes(2)
    expect(await db.deviceState.toArray()).toEqual(before)
    expect(await db.outbox.count()).toBe(0)
  })

  it('mất response hai lần liên tiếp thì báo chưa chắc và giữ nguyên ghép', async () => {
    vi.mocked(revokeShopDevice).mockRejectedValue(new SyncApiError('x', 'network', 0))
    vi.mocked(listShopDevices)
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
      .mockRejectedValueOnce(new SyncApiError('x', 'network', 0))

    const error = await captureError(unpairThisDevice())

    expect(error).toBeInstanceOf(UnpairUncertainError)
    expect(await getDeviceConnection()).toBeDefined()
  })

  it('lệnh thu hồi hết giờ nhưng hỏi lại thấy máy đã bị thu hồi thì về sổ cục bộ', async () => {
    vi.mocked(revokeShopDevice).mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'))
    vi.mocked(listShopDevices)
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
      .mockRejectedValueOnce(new SyncApiError('x', 'unauthorized', 401))

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(await getDeviceConnection()).toBeUndefined()
  })

  it('lệnh thu hồi lỗi máy chủ 5xx vẫn hỏi lại vì Worker có thể đã thu hồi xong', async () => {
    vi.mocked(revokeShopDevice).mockRejectedValue(new SyncApiError('x', 'request-failed', 503))
    vi.mocked(listShopDevices)
      .mockResolvedValueOnce({ devices: [currentDevice], latestSeq: 0 })
      .mockRejectedValueOnce(new SyncApiError('x', 'unauthorized', 401))

    await expect(unpairThisDevice()).resolves.toEqual({ droppedOperations: 0 })

    expect(listShopDevices).toHaveBeenCalledTimes(2)
    expect(await getDeviceConnection()).toBeUndefined()
  })

  it('lệnh thu hồi bị từ chối 4xx thì không hỏi lại và giữ nguyên ghép', async () => {
    const rejected = new SyncApiError('x', 'forbidden', 403)
    vi.mocked(revokeShopDevice).mockRejectedValue(rejected)

    await expect(unpairThisDevice()).rejects.toBe(rejected)

    expect(listShopDevices).toHaveBeenCalledTimes(1)
    expect(await getDeviceConnection()).toBeDefined()
  })
})
