import type { DeviceConnection } from '@/domain/schema'
import type { ServerEvent, SyncEvent } from '@shared/sync-events'

declare const __MY_BILLER_REMOTE_SYNC_URL__: string

const localHostnames = new Set(['127.0.0.1', 'localhost'])
const localSyncUrl = 'http://127.0.0.1:8787'

export function isLocalSyncHostname(hostname: string): boolean {
  return localHostnames.has(hostname)
}

export function resolveDefaultSyncUrl(hostname: string, remoteSyncUrl: string): string {
  if (isLocalSyncHostname(hostname)) return localSyncUrl
  return remoteSyncUrl
}

export const DEFAULT_SYNC_URL = resolveDefaultSyncUrl(
  globalThis.location?.hostname ?? '',
  __MY_BILLER_REMOTE_SYNC_URL__,
)

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
  ) {
    super(message)
  }
}

export async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new SyncApiError('Chưa có mạng. Kết nối Internet rồi thử lại.', 'network', 0)
  }

  const body = (await response.json().catch(() => null)) as
    | ({ error?: string; message?: string } & T)
    | null
  if (!response.ok) {
    throw new SyncApiError(
      body?.message ?? 'Không kết nối được với sổ chung. Thử lại.',
      body?.error ?? 'request-failed',
      response.status,
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

export function listShopDevices(
  connection: DeviceConnection,
): Promise<{ devices: ShopDevice[] }> {
  return jsonRequest(`${connection.syncUrl}/shop/${connection.shopId}/devices`, {
    headers: authHeaders(connection),
  })
}

export function revokeShopDevice(
  connection: DeviceConnection,
  deviceId: string,
): Promise<{ revoked: true; deviceId: string }> {
  return jsonRequest(
    `${connection.syncUrl}/shop/${connection.shopId}/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST', headers: authHeaders(connection) },
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
    body: JSON.stringify({ epoch, event }),
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
