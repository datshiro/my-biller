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
  isLocalSyncHostname,
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
const isLocalRuntime = isLocalSyncHostname(globalThis.location?.hostname ?? '')
const LEASE_MAINTENANCE_MS = 5_000
const REMOTE_POLL_MS = isLocalRuntime ? LOCAL_POLL_MS : 30_000

let started = false

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
    try {
      const connection = await getDeviceConnection()
      if (!connection) return
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
      if ((await getDeviceSyncState()).resyncRequired) await resetReadReplica(leader)
      await pullAll(connection, leader)
      await drainOutbox(connection, leader)
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
        await markDeviceRevoked()
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
  window.addEventListener('online', onOnline)
  window.addEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
  document.addEventListener('visibilitychange', onVisible)
  void tick()

  return () => {
    stopped = true
    started = false
    window.clearInterval(leaseTimer)
    window.clearInterval(remotePollTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
    document.removeEventListener('visibilitychange', onVisible)
    socket?.close()
  }
}
