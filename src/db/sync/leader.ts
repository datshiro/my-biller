import type { BillerDb } from '../db'
import { DeviceLeaseSchema, type DeviceLease } from '@/domain/schema'

export const LEASE_MS = 15_000

export type LeaderToken = Pick<DeviceLease, 'ownerId' | 'epoch'>

export async function claimLeadership(
  database: BillerDb,
  ownerId: string,
  now = Date.now(),
): Promise<LeaderToken | null> {
  return database.transaction('rw', database.deviceState, async () => {
    const current = (await database.deviceState.get('lease')) as DeviceLease | undefined
    if (current && current.ownerId !== ownerId && current.expiresAt > now) return null

    const epoch = current?.ownerId === ownerId ? current.epoch : (current?.epoch ?? 0) + 1
    const lease = DeviceLeaseSchema.parse({
      key: 'lease',
      ownerId,
      epoch,
      expiresAt: now + LEASE_MS,
    })
    await database.deviceState.put(lease)
    return { ownerId, epoch }
  })
}

export async function renewLeadership(
  database: BillerDb,
  leader: LeaderToken,
  now = Date.now(),
): Promise<boolean> {
  return database.transaction('rw', database.deviceState, async () => {
    const current = (await database.deviceState.get('lease')) as DeviceLease | undefined
    if (!current || current.ownerId !== leader.ownerId || current.epoch !== leader.epoch) return false
    await database.deviceState.put({ ...current, expiresAt: now + LEASE_MS })
    return true
  })
}

export async function assertLeadership(
  database: BillerDb,
  leader: LeaderToken,
): Promise<void> {
  const current = (await database.deviceState.get('lease')) as DeviceLease | undefined
  if (!current || current.ownerId !== leader.ownerId || current.epoch !== leader.epoch) {
    throw new Error('stale-leader')
  }
}
