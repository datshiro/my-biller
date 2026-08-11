// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://app.example/" }

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activatePairedDevice: vi.fn(),
  claimLeadership: vi.fn(),
  claimServerEpoch: vi.fn(),
  completeDevicePairing: vi.fn(),
  drainOutbox: vi.fn(),
  getDeviceConnection: vi.fn(),
  getDevicePairingState: vi.fn(),
  getDeviceSyncState: vi.fn(),
  listPendingOutbox: vi.fn(),
  markDeviceRevoked: vi.fn(),
  openSyncSocket: vi.fn(),
  pullAll: vi.fn(),
  renewLeadership: vi.fn(),
  resetReadReplica: vi.fn(),
}))

vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../repositories/device-state', () => ({
  completeDevicePairing: mocks.completeDevicePairing,
  getDeviceConnection: mocks.getDeviceConnection,
  getDevicePairingState: mocks.getDevicePairingState,
  getDeviceSyncState: mocks.getDeviceSyncState,
  markDeviceRevoked: mocks.markDeviceRevoked,
}))
vi.mock('../client', () => ({
  activatePairedDevice: mocks.activatePairedDevice,
  claimServerEpoch: mocks.claimServerEpoch,
  isLocalSyncHostname: () => false,
  SyncApiError: class SyncApiError extends Error {},
}))
vi.mock('../leader', () => ({
  claimLeadership: mocks.claimLeadership,
  renewLeadership: mocks.renewLeadership,
}))
vi.mock('../pusher', () => ({ drainOutbox: mocks.drainOutbox }))
vi.mock('../puller', () => ({ pullAll: mocks.pullAll }))
vi.mock('../socket', () => ({ openSyncSocket: mocks.openSyncSocket }))
vi.mock('../applier', () => ({ resetReadReplica: mocks.resetReadReplica }))
vi.mock('../outbox', () => ({
  listPendingOutbox: mocks.listPendingOutbox,
  OUTBOX_CHANGED_EVENT: 'my-biller:outbox-changed',
}))

import { startSyncRunner } from '../runner'

const connection = {
  shopId: '00000000-0000-0000-0000-000000000001',
  deviceId: 'device-a',
  token: 'token-a',
  syncUrl: 'https://sync.example',
}
const leader = { ownerId: 'owner-a', epoch: 1 }

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('sync runner polling', () => {
  let stop: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'))
    for (const mock of Object.values(mocks)) mock.mockReset()

    mocks.getDeviceConnection.mockResolvedValue(connection)
    mocks.getDevicePairingState.mockResolvedValue(null)
    mocks.getDeviceSyncState.mockResolvedValue({ resyncRequired: false })
    mocks.claimLeadership.mockResolvedValue(leader)
    mocks.renewLeadership.mockResolvedValue(true)
    mocks.claimServerEpoch.mockResolvedValue({ epoch: 1 })
    mocks.pullAll.mockResolvedValue(0)
    mocks.drainOutbox.mockResolvedValue(undefined)
    mocks.openSyncSocket.mockReturnValue({
      readyState: WebSocket.OPEN,
      close: vi.fn(),
    } as unknown as WebSocket)
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    vi.useRealTimers()
  })

  it('duy trì lease mỗi 5 giây nhưng chỉ poll mạng dự phòng sau 30 giây', async () => {
    stop = startSyncRunner()
    await flushAsyncWork()

    expect(mocks.claimServerEpoch).toHaveBeenCalledTimes(1)
    expect(mocks.pullAll).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(25_000)
    expect(mocks.renewLeadership).toHaveBeenCalledTimes(6)
    expect(mocks.claimServerEpoch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.claimServerEpoch).toHaveBeenCalledTimes(2)
    expect(mocks.pullAll).toHaveBeenCalledTimes(4)
  })

  it('outbox mới vẫn ép đồng bộ ngay trước hạn poll dự phòng', async () => {
    stop = startSyncRunner()
    await flushAsyncWork()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mocks.claimServerEpoch).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('my-biller:outbox-changed'))
    await flushAsyncWork()

    expect(mocks.claimServerEpoch).toHaveBeenCalledTimes(2)
    expect(mocks.drainOutbox).toHaveBeenCalledTimes(2)
  })
})
