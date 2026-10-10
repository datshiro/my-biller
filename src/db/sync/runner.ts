import { db } from '../db'
import {
  completeDevicePairing,
  getDeviceConnection,
  getDevicePairingState,
  markDeviceRevoked,
} from '../repositories/device-state'
import {
  activatePairedDevice,
  claimServerEpoch,
  SYNC_IS_LOCAL,
  SyncApiError,
} from './client'
import { claimLeadership, renewLeadership, type LeaderToken } from './leader'
import { drainOutbox } from './pusher'
import { pullAll } from './puller'
import { openSyncSocket } from './socket'
import { getDeviceSyncState } from '../repositories/device-state'
import { resetReadReplica } from './applier'
import { listPendingOutbox, OUTBOX_CHANGED_EVENT } from './outbox'

const LOCAL_POLL_MS = 2_000
const LEASE_MAINTENANCE_MS = 5_000
const REMOTE_POLL_MS = SYNC_IS_LOCAL ? LOCAL_POLL_MS : 30_000

let started = false

/** Màn nào cần số mới ngay (Đối soát) thì dispatch sự kiện này; không dispatch `online` giả. */
export const SYNC_WAKE_EVENT = 'my-biller:sync-wake'

export function startSyncRunner(): () => void {
  if (started || typeof window === 'undefined') return () => undefined
  started = true
  const ownerId = crypto.randomUUID()
  let leader: LeaderToken | null = null
  let socket: WebSocket | null = null
  let running = false
  let rerunRequested = false
  let forceRerunRequested = false
  let stopped = false

  const tick = async (forceRemoteSync = true) => {
    if (stopped) return
    if (running) {
      rerunRequested = true
      forceRerunRequested ||= forceRemoteSync
      return
    }
    running = true
    let token: string | null = null
    try {
      const connection = await getDeviceConnection()
      if (!connection) return
      token = connection.token
      const pairing = await getDevicePairingState()
      if (pairing?.connectionSaved) {
        await activatePairedDevice(connection, await listPendingOutbox())
        await completeDevicePairing(pairing.attemptId)
      }
      const hadLeadership = leader !== null
      leader ??= await claimLeadership(db, ownerId)
      if (!leader) return

      if (!(await renewLeadership(db, leader))) {
        leader = null
        socket?.close()
        socket = null
        return
      }

      if (!forceRemoteSync && hadLeadership) return

      await claimServerEpoch(connection, leader.epoch)
      // `resetReadReplica` tự ném khi outbox còn dòng — và từ khi `item-name-taken.ts` có thể bật
      // `resyncRequired` trong lúc outbox vẫn còn dòng khác (đơn bán của món khác, chưa tới lượt đẩy),
      // gọi mù ở đây sẽ ném TRƯỚC `drainOutbox`, nuốt lỗi (nhánh catch chỉ xử lý stale-leader/401), và
      // không bao giờ drain được nữa — máy kẹt ghi vĩnh viễn. Chỉ reset khi chắc outbox đã rỗng, và thử
      // lại một lần nữa sau khi drain cho lượt vừa mới rỗng.
      const canResetReplica = async () =>
        (await getDeviceSyncState()).resyncRequired && (await listPendingOutbox()).length === 0
      if (await canResetReplica()) await resetReadReplica(leader)
      await pullAll(connection, leader)
      await drainOutbox(connection, leader)
      if (await canResetReplica()) await resetReadReplica(leader)
      await pullAll(connection, leader)

      if (!socket || socket.readyState >= WebSocket.CLOSING) {
        socket = openSyncSocket(connection, () => void tick())
      }
    } catch (caught) {
      if (caught instanceof SyncApiError && caught.code === 'stale-leader') {
        leader = null
        socket?.close()
        socket = null
      } else if (caught instanceof SyncApiError && caught.status === 401) {
        if (token) await markDeviceRevoked(token)
      }
      // Lỗi mạng được lượt kéo định kỳ thử lại. Outbox không bị đụng tới.
    } finally {
      running = false
      if (rerunRequested) {
        const forceRemoteSync = forceRerunRequested
        rerunRequested = false
        forceRerunRequested = false
        void tick(forceRemoteSync)
      }
    }
  }

  const leaseTimer = window.setInterval(() => void tick(false), LEASE_MAINTENANCE_MS)
  const remotePollTimer = window.setInterval(() => void tick(), REMOTE_POLL_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick()
  }
  const onOnline = () => void tick()
  const onOutboxChanged = () => void tick()
  const onWake = () => void tick()
  window.addEventListener('online', onOnline)
  window.addEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
  window.addEventListener(SYNC_WAKE_EVENT, onWake)
  document.addEventListener('visibilitychange', onVisible)
  void tick()

  return () => {
    stopped = true
    started = false
    window.clearInterval(leaseTimer)
    window.clearInterval(remotePollTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
    window.removeEventListener(SYNC_WAKE_EVENT, onWake)
    document.removeEventListener('visibilitychange', onVisible)
    socket?.close()
  }
}
