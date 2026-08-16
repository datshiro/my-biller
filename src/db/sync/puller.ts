import { getDeviceSyncState } from '../repositories/device-state'
import { applyEvents } from './applier'
import { pullEvents } from './client'
import type { LeaderToken } from './leader'
import type { DeviceConnection } from '@/domain/schema'

export async function pullAll(connection: DeviceConnection, leader: LeaderToken): Promise<number> {
  let pulled = 0
  for (;;) {
    const sync = await getDeviceSyncState()
    const batch = await pullEvents(connection, sync.lastSeq)
    await applyEvents(batch.events, leader)
    pulled += batch.events.length
    if (!batch.hasMore) return pulled
  }
}
