import { db } from '../db'
import {
  completeDevicePairing,
  getDeviceConnection,
  getDevicePairingState,
  markDeviceRevoked,
} from '../repositories/device-state'
import { activatePairedDevice, claimServerEpoch, SyncApiError } from './client'
import { claimLeadership, renewLeadership, type LeaderToken } from './leader'
import { drainOutbox } from './pusher'
import { pullAll } from './puller'
import { openSyncSocket } from './socket'
import { getDeviceSyncState } from '../repositories/device-state'
import { resetReadReplica } from './applier'
import { listPendingOutbox, OUTBOX_CHANGED_EVENT } from './outbox'

const POLL_MS = 2_000

let started = false

export function startSyncRunner(): () => void {
  if (started || typeof window === 'undefined') return () => undefined
  started = true
  const ownerId = crypto.randomUUID()
  let leader: LeaderToken | null = null
  let socket: WebSocket | null = null
  let running = false
  let rerunRequested = false
  let stopped = false

  const tick = async () => {
    if (stopped) return
    if (running) {
      rerunRequested = true
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
      leader ??= await claimLeadership(db, ownerId)
      if (!leader) return

      if (!(await renewLeadership(db, leader))) {
        leader = null
        socket?.close()
        socket = null
        return
      }
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
        rerunRequested = false
        void tick()
      }
    }
  }

  const timer = window.setInterval(() => void tick(), POLL_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick()
  }
  const onOutboxChanged = () => void tick()
  window.addEventListener('online', tick)
  window.addEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
  document.addEventListener('visibilitychange', onVisible)
  void tick()

  return () => {
    stopped = true
    started = false
    window.clearInterval(timer)
    window.removeEventListener('online', tick)
    window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutboxChanged)
    document.removeEventListener('visibilitychange', onVisible)
    socket?.close()
  }
}
