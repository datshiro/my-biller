import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { wipeAllData } from '../backup'
import { db } from '../db'
import { resetDbBlock } from '../db-block'
import {
  beginDevicePairing,
  completeDevicePairing,
  getDeviceIdentity,
  getOrCreateInstallId,
  leaveSharedLedger,
  markDeviceRevoked,
  saveDeviceIdentity,
  savePairedDevice,
} from '../repositories/device-state'
import { DeviceStateSchema } from '@/domain/schema'
import { testGid } from '@/test-fixtures'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  resetDbBlock()
})

async function pairThisDevice() {
  await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
  const pairing = await beginDevicePairing()
  await savePairedDevice({
    pairingAttemptId: pairing.attemptId,
    admissionExpiresAt: Date.now() + 60_000,
    deviceId: testGid(10),
    label: 'Quầy trước',
    letter: 'A',
    shopId: testGid(500),
    token: 't'.repeat(43),
    syncUrl: 'https://sync.example.com',
  })
  await completeDevicePairing(pairing.attemptId)
}

describe('mã cài đặt của máy', () => {
  it('chưa gọi thì chưa tạo khoá install', async () => {
    await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
    expect(await db.deviceState.get('install')).toBeUndefined()
  })

  it('hai lần gọi trả cùng một mã dạng UUID', async () => {
    const first = await getOrCreateInstallId()
    const second = await getOrCreateInstallId()
    expect(first).toMatch(UUID)
    expect(second).toBe(first)
  })

  it('mã cài đặt sống qua ghép máy, thu hồi, rời sổ chung và xoá sổ', async () => {
    const installId = await getOrCreateInstallId()

    await pairThisDevice()
    expect(await getOrCreateInstallId()).toBe(installId)

    await markDeviceRevoked()
    expect(await getOrCreateInstallId()).toBe(installId)

    await leaveSharedLedger({ kind: 'revoked' })
    expect(await getOrCreateInstallId()).toBe(installId)

    await wipeAllData()
    expect(await getOrCreateInstallId()).toBe(installId)
  })

  it('tạo mã cài đặt không đổi danh tính của máy', async () => {
    await saveDeviceIdentity({ label: 'Quầy trước', letter: 'A' })
    const identityBefore = await getDeviceIdentity()

    await getOrCreateInstallId()

    expect(await getDeviceIdentity()).toEqual(identityBefore)
  })

  it('schema device state nhận khoá install với installId là UUID', async () => {
    const installId = await getOrCreateInstallId()
    expect(() =>
      DeviceStateSchema.parse({ key: 'install', installId, createdAt: 1 }),
    ).not.toThrow()
  })
})
