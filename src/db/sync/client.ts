import { Capacitor } from '@capacitor/core'
import type { DeviceConnection } from '@/domain/schema'
import type { ServerEvent, SyncEvent } from '@shared/sync-events'

declare const __MY_BILLER_REMOTE_SYNC_URL__: string

const localHostnames = new Set(['127.0.0.1', 'localhost'])
const localSyncUrl = 'http://127.0.0.1:8787'

export function isLocalSyncHostname(hostname: string): boolean {
  return localHostnames.has(hostname)
}

/** APK chạy WebView ở `https://localhost`, nên hostname không nói được máy có đang ở môi trường local hay không. */
export function resolveDefaultSyncUrl(hostname: string, remoteSyncUrl: string, native = false): string {
  if (native) return remoteSyncUrl
  if (isLocalSyncHostname(hostname)) return localSyncUrl
  return remoteSyncUrl
}

// Chỉ APK bản dựng mới trỏ remote: Robot và Playwright chạy Vite dev với shim APK giả, phải giữ Worker local.
export const DEFAULT_SYNC_URL = resolveDefaultSyncUrl(
  globalThis.location?.hostname ?? '',
  __MY_BILLER_REMOTE_SYNC_URL__,
  Capacitor.isNativePlatform() && !import.meta.env.DEV,
)

export const SYNC_IS_LOCAL = DEFAULT_SYNC_URL === localSyncUrl

export type PairedDevice = {
  shopId: string
  deviceId: string
  token: string
  label: string
  letter: string
  admissionExpiresAt: number
}

export type ShopDevice = {
  id: string
  letter: string
  label: string
  createdAt: number
  revokedAt: number | null
  current: boolean
}

export class SyncApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (caught) {
    // Bị huỷ bởi chính caller (unmount, bấm lại, hết giờ) thì không phải mất mạng — trả nguyên lỗi.
    if (init.signal?.aborted) throw caught
    throw new SyncApiError('Chưa có mạng. Kết nối Internet rồi thử lại.', 'network', 0)
  }

  const body = (await response.json().catch(() => null)) as
    | ({ error?: string; message?: string } & T)
    | null
  // Huỷ giữa lúc đọc body bị `.catch` ở trên nuốt thành `null`; trả lỗi huỷ cho caller thay vì body rỗng.
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError')
  if (!response.ok) {
    throw new SyncApiError(
      body?.message ?? 'Không kết nối được với sổ chung. Thử lại.',
      body?.error ?? 'request-failed',
      response.status,
      body ?? undefined,
    )
  }
  return body as T
}

export const authHeaders = (connection: DeviceConnection) => ({
  authorization: `Bearer ${connection.token}`,
})

export function pairDevice(input: {
  code: string
  label: string
  letter: string
  hasLocalLedger: boolean
  localLedgerRows: number
  syncUrl?: string
  installId?: string
}): Promise<PairedDevice> {
  const syncUrl = input.syncUrl ?? DEFAULT_SYNC_URL
  return jsonRequest(`${syncUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: input.code,
      label: input.label,
      letter: input.letter,
      hasLocalLedger: input.hasLocalLedger,
      localLedgerRows: input.localLedgerRows,
      ...(input.installId ? { installId: input.installId } : {}),
    }),
  })
}

export function createPairCode(
  connection: DeviceConnection,
): Promise<{ code: string; expiresAt: number }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/pair-code`, {
    method: 'POST',
    headers: authHeaders(connection),
  })
}

/** `latestSeq` vắng khi Worker chưa lên bản có trường này — là trạng thái hợp lệ, không phải `0`. */
export function listShopDevices(
  connection: DeviceConnection,
  options: { signal?: AbortSignal } = {},
): Promise<{ devices: ShopDevice[]; latestSeq?: number }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/devices`, {
    headers: authHeaders(connection),
    signal: options.signal,
  })
}

export function revokeShopDevice(
  connection: DeviceConnection,
  deviceId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ revoked: true; deviceId: string }> {
  return jsonRequest(
    `${connection.syncUrl}/shop/${connection.shopId}/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST', headers: authHeaders(connection), signal: options.signal },
  )
}

export function claimServerEpoch(connection: DeviceConnection, epoch: number): Promise<{ epoch: number }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/epoch`, {
    method: 'POST',
    headers: { ...authHeaders(connection), 'content-type': 'application/json' },
    body: JSON.stringify({ epoch }),
  })
}

export function pushEvent(
  connection: DeviceConnection,
  epoch: number,
  event: SyncEvent,
): Promise<{ seq: number; duplicate: boolean }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/events`, {
    method: 'POST',
    headers: { ...authHeaders(connection), 'content-type': 'application/json' },
    body: JSON.stringify({ epoch, event, caps: ['item-name-taken'] }),
  })
}

export function activatePairedDevice(
  connection: DeviceConnection,
  events: readonly SyncEvent[],
): Promise<{ activated: true; lastSeq: number }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/seed`, {
    method: 'POST',
    headers: { ...authHeaders(connection), 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  })
}

export function pullEvents(
  connection: DeviceConnection,
  since: number,
): Promise<{ events: ServerEvent[]; hasMore: boolean }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/oplog?since=${since}`, {
    headers: authHeaders(connection),
  })
}
