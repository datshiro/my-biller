import { db } from '../db'
import { getDeviceSyncState, leaveSharedLedger } from '../repositories/device-state'
import { listShopDevices, revokeShopDevice, SyncApiError } from './client'
import { countPendingOperations } from './outbox'
import { DeviceConnectionSchema } from '@/domain/schema'

export type UnpairBlock = 'offline' | 'pairing' | 'pending' | 'resync' | 'behind' | 'unknown-device'

export class UnpairBlockedError extends Error {
  constructor(
    readonly reason: UnpairBlock,
    readonly pending = 0,
  ) {
    super(`Chưa huỷ ghép được: ${reason}`)
    this.name = 'UnpairBlockedError'
  }
}

/** Đã gửi lệnh thu hồi nhưng cả lệnh lẫn lần hỏi lại đều mất mạng — không biết Worker đã thu hồi chưa. */
export class UnpairUncertainError extends Error {
  constructor(
    message = 'Chưa chắc lệnh huỷ ghép đã tới sổ chung. Có mạng lại thì bấm Huỷ ghép máy này lần nữa.',
  ) {
    super(message)
    this.name = 'UnpairUncertainError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000

// WebView cũ chưa có `AbortSignal.timeout`; lý do huỷ vẫn là `TimeoutError` để `isTimeout` nhận ra.
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms)
  return controller.signal
}

const isRevoked = (caught: unknown) => caught instanceof SyncApiError && caught.status === 401

export const isTimeout = (caught: unknown) =>
  caught instanceof DOMException && (caught.name === 'AbortError' || caught.name === 'TimeoutError')

// 5xx cũng tính: Worker ghi `revokedAt` trước rồi mới đóng socket, nên lỗi sau đó vẫn có thể là đã thu hồi.
const isLostResponse = (caught: unknown) =>
  (caught instanceof SyncApiError && (caught.code === 'network' || caught.status >= 500)) ||
  isTimeout(caught)

/**
 * Thu hồi là lệnh không đảo ngược được, nên mọi điều kiện cục bộ và độ tươi của bản sao phải qua trước: hàng
 * đợi rỗng (bỏ nó có thể bỏ thao tác đã lên Worker mà chưa kịp xoá dòng) và bản sao đã đuổi kịp `latestSeq`
 * (đóng băng bản sao dở dang làm sổ cục bộ là sổ sai mà màn vẫn trông đúng).
 */
export async function unpairThisDevice(): Promise<{ droppedOperations: number }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new UnpairBlockedError('offline')
  }
  const { connection, lastSeq } = await db.transaction('r', db.deviceState, db.outbox, async () => {
    const [row, pairing, sync, pending] = await Promise.all([
      db.deviceState.get('connection'),
      db.deviceState.get('pairing'),
      getDeviceSyncState(),
      countPendingOperations(),
    ])
    if (row?.key !== 'connection') throw new Error('Máy này chưa ghép.')
    if (
      pairing?.key === 'pairing' &&
      (pairing.connectionSaved || pairing.expiresAt > Date.now())
    ) {
      throw new UnpairBlockedError('pairing')
    }
    if (sync.resyncRequired) throw new UnpairBlockedError('resync')
    if (pending > 0) throw new UnpairBlockedError('pending', pending)
    return { connection: DeviceConnectionSchema.parse(row), lastSeq: sync.lastSeq }
  })

  const leave = () => leaveSharedLedger({ kind: 'connected', token: connection.token })
  const listDevices = () =>
    listShopDevices(connection, { signal: timeoutSignal(REQUEST_TIMEOUT_MS) })

  let listed: Awaited<ReturnType<typeof listShopDevices>>
  try {
    listed = await listDevices()
  } catch (caught) {
    if (isRevoked(caught)) return leave()
    throw caught
  }
  const current = listed.devices.find((device) => device.current)
  if (!current) throw new UnpairBlockedError('unknown-device')
  if (listed.latestSeq !== undefined && lastSeq < listed.latestSeq) {
    throw new UnpairBlockedError('behind')
  }

  try {
    await revokeShopDevice(connection, current.id, {
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    })
  } catch (caught) {
    if (isRevoked(caught)) return leave()
    if (!isLostResponse(caught)) throw caught
    try {
      await listDevices()
    } catch (recheck) {
      if (isRevoked(recheck)) return leave()
      if (isLostResponse(recheck)) throw new UnpairUncertainError()
      throw recheck
    }
    throw caught
  }
  return leave()
}
