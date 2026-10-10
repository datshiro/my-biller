import { HeartbeatSchema, type Heartbeat } from '@shared/admin-contract'
import { version } from '../../package.json'
// Chỉ đọc `count()` của hai bảng, không ghi; luật cấm nhắm vào ghi thẳng bảng ngoài repository.
// eslint-disable-next-line no-restricted-imports
import { db } from '@/db/db'
import { getLedgerOverview } from '@/db/doi-soat-snapshot'
import {
  getDeviceConnection,
  getDevicePairingState,
  getOrCreateInstallId,
} from '@/db/repositories/device-state'
import { getShop } from '@/db/repositories/settings'
import { DEFAULT_SYNC_URL } from '@/db/sync/client'
import { isNativeApp } from '@/features/printer/printer-sink'

export const HEARTBEAT_AT_KEY = 'my-biller:heartbeat-at'
export const HEARTBEAT_BACKOFF_KEY = 'my-biller:heartbeat-backoff-until'

const MINUTE = 60_000
const OPEN_DELAY_MS = 3_000
const OPEN_FRESH_MS = 15 * MINUTE
const TICK_MS = 60 * MINUTE
const TICK_FRESH_MS = 6 * 60 * MINUTE
const BACKOFF_MS = MINUTE
const SHOP_NAME_MAX = 80

let started = false
let inFlight: AbortController | null = null
/** Body của lần gửi lỗi mạng, 5xx hoặc 429; `online`/`visibilitychange` chỉ gửi lại body này, không quét sổ lần nữa. */
let pending: Heartbeat | null = null

const readTime = (key: string) => Number(localStorage.getItem(key) ?? 0)

const canReachWorker = () => navigator.onLine !== false && Date.now() >= readTime(HEARTBEAT_BACKOFF_KEY)

async function isPairedOrPairing(): Promise<boolean> {
  const [connection, pairing] = await Promise.all([getDeviceConnection(), getDevicePairingState()])
  return connection !== undefined || (pairing !== undefined && pairing.expiresAt > Date.now())
}

function detectPlatform(): Heartbeat['platform'] {
  if (isNativeApp()) return 'apk'
  if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) return 'pwa'
  return 'browser'
}

async function buildHeartbeat(): Promise<Heartbeat> {
  const [installId, shop, orderCount, customerCount, overview] = await Promise.all([
    getOrCreateInstallId(),
    getShop(),
    db.orders.count(),
    db.customers.count(),
    getLedgerOverview(),
  ])
  return HeartbeatSchema.parse({
    installId,
    shopName: shop.name.slice(0, SHOP_NAME_MAX),
    appVersion: version,
    platform: detectPlatform(),
    orderCount,
    customerCount,
    debtTotal: overview.totals.debtTotal,
  })
}

async function post(body: Heartbeat): Promise<void> {
  // Đọc lại ngay trước fetch: ghép máy có thể vừa xong trong lúc dựng body, và heartbeat tới sau `/pair`
  // sẽ đưa máy về "chưa ghép" trên server.
  if (await isPairedOrPairing()) {
    pending = null
    return
  }
  const controller = new AbortController()
  inFlight = controller
  pending = body
  try {
    const response = await fetch(`${DEFAULT_SYNC_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (response.ok) {
      localStorage.setItem(HEARTBEAT_AT_KEY, String(Date.now()))
      if (pending === body) pending = null
    } else if (response.status === 429) {
      localStorage.setItem(HEARTBEAT_BACKOFF_KEY, String(Date.now() + BACKOFF_MS))
    } else if (response.status < 500) {
      // Worker từ chối chính body này; gửi lại y nguyên chỉ bị từ chối tiếp. Lượt hẹn giờ sau dựng body mới.
      if (pending === body) pending = null
    }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/** Không bao giờ ném: heartbeat không được chặn bán hàng. */
export async function sendUnpairedHeartbeat(freshMs: number): Promise<void> {
  try {
    if (inFlight || !canReachWorker()) return
    if (Date.now() - readTime(HEARTBEAT_AT_KEY) < freshMs) return
    if (await isPairedOrPairing()) return
    await post(await buildHeartbeat())
  } catch {
    // Mất mạng hoặc Worker lỗi: body còn trong `pending` để gửi lại.
  }
}

export async function retryPendingHeartbeat(): Promise<void> {
  try {
    if (!pending || inFlight || !canReachWorker()) return
    await post(pending)
  } catch {
    // Giữ body chờ cho lượt sau.
  }
}

/** Gọi trước khi bắt đầu ghép: body đang bay hoặc đang chờ thuộc về máy chưa ghép, không được gửi nữa. */
export function abortUnpairedHeartbeat(): void {
  inFlight?.abort()
  inFlight = null
  pending = null
}

/** Máy vừa rời sổ chung báo ngay để server không giữ trạng thái "đã ghép" tới lượt 6 giờ sau. */
export function heartbeatAfterLeave(): void {
  localStorage.removeItem(HEARTBEAT_AT_KEY)
  void sendUnpairedHeartbeat(0)
}

export function startUnpairedHeartbeat(): () => void {
  if (started || typeof window === 'undefined') return () => undefined
  started = true
  void getOrCreateInstallId().catch(() => undefined)

  const openTimer = window.setTimeout(() => void sendUnpairedHeartbeat(OPEN_FRESH_MS), OPEN_DELAY_MS)
  const tickTimer = window.setInterval(() => void sendUnpairedHeartbeat(TICK_FRESH_MS), TICK_MS)
  const onOnline = () => void retryPendingHeartbeat()
  const onVisible = () => {
    if (document.visibilityState === 'visible') void retryPendingHeartbeat()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    started = false
    window.clearTimeout(openTimer)
    window.clearInterval(tickTimer)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
