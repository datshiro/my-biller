import { db } from '../db'
import { newGid } from '@/domain/gid'
import {
  DeviceConnectionSchema,
  DeviceIdentitySchema,
  DeviceNoticeSchema,
  DevicePairingLockSchema,
  DeviceWriteBlockSchema,
  type DeviceConnection,
  type DeviceIdentity,
  type DeviceNotice,
  type DeviceSyncState,
} from '@/domain/schema'
import { LEDGER_TABLE_NAMES } from '@shared/sync-events'
import { stageExistingLedger } from '../sync/outbox'

export type DeviceIdentityInput = Pick<DeviceIdentity, 'label' | 'letter'>

const PAIRING_LOCK_MS = 2 * 60 * 1000

export async function beginDevicePairing(): Promise<{
  attemptId: string
  hasLocalLedger: boolean
  localLedgerRows: number
}> {
  const ledgerTables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  return db.transaction('rw', [...ledgerTables, db.deviceState], async () => {
    const current = await db.deviceState.get('pairing')
    if (current?.key === 'pairing' && current.expiresAt > Date.now()) {
      throw new Error('Máy đang được ghép ở một tab khác. Chờ thao tác đó xong rồi thử lại.')
    }
    const writeBlock = await db.deviceState.get('writeBlock')
    const counts = await Promise.all(ledgerTables.map((table) => table.count()))
    const localLedgerRows =
      writeBlock?.key === 'writeBlock' && writeBlock.reason === 'revoked'
        ? 0
        : counts.reduce((total, count) => total + count, 0)
    const hasLocalLedger = localLedgerRows > 0
    const attemptId = newGid()
    await db.deviceState.put(
      DevicePairingLockSchema.parse({
        key: 'pairing',
        attemptId,
        hasLocalLedger,
        localLedgerRows,
        connectionSaved: false,
        expiresAt: Date.now() + PAIRING_LOCK_MS,
      }),
    )
    return { attemptId, hasLocalLedger, localLedgerRows }
  })
}

export async function cancelDevicePairing(attemptId: string): Promise<void> {
  await db.transaction('rw', db.deviceState, async () => {
    const current = await db.deviceState.get('pairing')
    if (current?.key === 'pairing' && current.attemptId === attemptId) {
      await db.deviceState.delete('pairing')
    }
  })
}

export function getDeviceIdentity(): Promise<DeviceIdentity | undefined> {
  return db.deviceState.get('identity') as Promise<DeviceIdentity | undefined>
}

export function getDeviceConnection(): Promise<DeviceConnection | undefined> {
  return db.deviceState.get('connection') as Promise<DeviceConnection | undefined>
}

/** Một ảnh đọc duy nhất để UI không ghép kết quả từ hai observer ở hai thời điểm khác nhau. */
export function getDeviceConnectionSnapshot() {
  return db.transaction('r', db.deviceState, async () => {
    const [connection, pairing] = await Promise.all([
      db.deviceState.get('connection'),
      db.deviceState.get('pairing'),
    ])
    return {
      connection:
        connection?.key === 'connection' ? DeviceConnectionSchema.parse(connection) : null,
      pairing: pairing?.key === 'pairing' ? DevicePairingLockSchema.parse(pairing) : null,
    }
  })
}

export async function requireDeviceIdentity(): Promise<DeviceIdentity> {
  const identity = await getDeviceIdentity()
  if (!identity) throw new Error('Máy này chưa được đặt tên và chữ cái.')
  return identity
}

export async function saveDeviceIdentity(input: DeviceIdentityInput): Promise<void> {
  if (await getDeviceConnection()) {
    throw new Error('Máy đã ghép phải giữ nguyên tên và chữ cái. Thu hồi rồi ghép lại nếu cần đổi.')
  }
  const current = await getDeviceIdentity()
  const identity = DeviceIdentitySchema.parse({
    key: 'identity',
    deviceId: current?.deviceId ?? newGid(),
    label: input.label,
    letter: input.letter.trim().toUpperCase(),
  })
  await db.deviceState.put(identity)
}

export async function savePairedDevice(input: {
  pairingAttemptId: string
  admissionExpiresAt: number
  deviceId: string
  label: string
  letter: string
  shopId: string
  token: string
  syncUrl: string
}): Promise<void> {
  const identity = DeviceIdentitySchema.parse({
    key: 'identity',
    deviceId: input.deviceId,
    label: input.label,
    letter: input.letter,
  })
  const connection = DeviceConnectionSchema.parse({
    key: 'connection',
    shopId: input.shopId,
    token: input.token,
    syncUrl: input.syncUrl,
  })
  const ledgerTables = LEDGER_TABLE_NAMES.map((name) => db.table(name))
  await db.transaction('rw', [...ledgerTables, db.outbox, db.deviceState], async (transaction) => {
    const pairing = await db.deviceState.get('pairing')
    if (
      pairing?.key !== 'pairing' ||
      pairing.attemptId !== input.pairingAttemptId ||
      pairing.expiresAt <= Date.now()
    ) {
      throw new Error('Lượt ghép máy đã hết hạn. Tạo mã mới và thử lại.')
    }
    const writeBlock = await db.deviceState.get('writeBlock')
    if (writeBlock?.key === 'writeBlock' && writeBlock.reason === 'revoked') {
      await Promise.all(ledgerTables.map((table) => table.clear()))
      await db.outbox.clear()
    } else {
      const localLedgerRows = (
        await Promise.all(ledgerTables.map((table) => table.count()))
      ).reduce((total, count) => total + count, 0)
      if (localLedgerRows !== pairing.localLedgerRows) {
        throw new Error('Dữ liệu trên máy đã đổi trong lúc ghép. Hãy thử lại để đối soát đúng sổ.')
      }
      const stagedRows = await stageExistingLedger(transaction)
      if (stagedRows !== pairing.localLedgerRows) {
        throw new Error('Không chụp đủ dữ liệu để nạp sổ. Hãy thử ghép lại.')
      }
    }
    const previousSync = await getDeviceSyncState()
    await db.deviceState.bulkPut([identity, connection])
    await db.deviceState.put({
      key: 'sync',
      lastSeq: 0,
      revision: previousSync.revision + 1,
      resyncRequired: false,
      lastConnectedAt: null,
    })
    await db.deviceState.delete('lease')
    await db.deviceState.delete('notice')
    await db.deviceState.delete('writeBlock')
    await db.deviceState.put(
      DevicePairingLockSchema.parse({
        ...pairing,
        connectionSaved: true,
        expiresAt: input.admissionExpiresAt,
      }),
    )
  })
}

export async function getDevicePairingState() {
  const pairing = await db.deviceState.get('pairing')
  return pairing?.key === 'pairing' ? pairing : undefined
}

export async function completeDevicePairing(attemptId: string): Promise<void> {
  await db.transaction('rw', db.deviceState, db.outbox, async () => {
    const pairing = await db.deviceState.get('pairing')
    if (pairing?.key !== 'pairing' || pairing.attemptId !== attemptId) return
    await db.outbox.clear()
    await db.deviceState.delete('pairing')
  })
}

export function clearDeviceConnection(): Promise<void> {
  return db.deviceState.delete('connection')
}

export async function getDeviceSyncState(): Promise<DeviceSyncState> {
  const current = (await db.deviceState.get('sync')) as DeviceSyncState | undefined
  return (
    current ?? {
      key: 'sync',
      lastSeq: 0,
      revision: 0,
      resyncRequired: false,
      lastConnectedAt: null,
    }
  )
}

export function getDeviceNotice(): Promise<DeviceNotice | undefined> {
  return db.deviceState
    .get('notice')
    .then((row) => (row ? DeviceNoticeSchema.parse(row) : undefined))
}

/** Chỉ xoá đúng thông báo người dùng vừa thấy; thông báo mới đến đồng thời phải được giữ lại. */
export async function clearDeviceNotice(id: string): Promise<void> {
  await db.transaction('rw', db.deviceState, async () => {
    const current = await getDeviceNotice()
    if (current?.id === id && current.kind === 'sync') await db.deviceState.delete('notice')
  })
}

export function saveDeviceNotice(
  message: string,
  kind: 'sync' | 'revoked' = 'sync',
): Promise<string> {
  return db.deviceState.put(
    DeviceNoticeSchema.parse({
      key: 'notice',
      id: crypto.randomUUID(),
      kind,
      message,
      createdAt: Date.now(),
    }),
  )
}

export function markDeviceRevoked(): Promise<void> {
  const message =
    'Máy này đã bị thu hồi. Thay đổi mới không thể lên sổ chung; hãy ghép lại để tiếp tục.'
  return db.transaction('rw', db.deviceState, async () => {
    const connection = await getDeviceConnection()
    await db.deviceState.put(
      DeviceNoticeSchema.parse({
        key: 'notice',
        id: crypto.randomUUID(),
        kind: 'revoked',
        message,
        createdAt: Date.now(),
      }),
    )
    await db.deviceState.put(
      DeviceWriteBlockSchema.parse({
        key: 'writeBlock',
        reason: 'revoked',
        shopId: connection?.shopId ?? null,
        createdAt: Date.now(),
      }),
    )
    await db.deviceState.delete('connection')
    await db.deviceState.delete('pairing')
  })
}
