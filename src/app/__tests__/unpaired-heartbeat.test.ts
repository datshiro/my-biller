// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { HeartbeatSchema } from '@shared/admin-contract'
import { version } from '../../../package.json'
import { DEFAULT_SYNC_URL } from '@/db/sync/client'
import {
  abortUnpairedHeartbeat,
  heartbeatAfterLeave,
  retryPendingHeartbeat,
  sendUnpairedHeartbeat,
  startUnpairedHeartbeat,
} from '../unpaired-heartbeat'

const m = vi.hoisted(() => ({
  ordersCount: vi.fn(),
  customersCount: vi.fn(),
  deviceStateGet: vi.fn(),
  getDeviceConnection: vi.fn(),
  getDevicePairingState: vi.fn(),
  getOrCreateInstallId: vi.fn(),
  getLedgerOverview: vi.fn(),
  getShop: vi.fn(),
  isNativeApp: vi.fn(),
}))

vi.mock('@/db/db', () => ({
  db: {
    orders: { count: m.ordersCount },
    customers: { count: m.customersCount },
    deviceState: { get: m.deviceStateGet },
  },
}))
vi.mock('@/db/repositories/device-state', () => ({
  getDeviceConnection: m.getDeviceConnection,
  getDevicePairingState: m.getDevicePairingState,
  getOrCreateInstallId: m.getOrCreateInstallId,
}))
vi.mock('@/db/doi-soat-snapshot', () => ({ getLedgerOverview: m.getLedgerOverview }))
vi.mock('@/db/repositories/settings', () => ({ getShop: m.getShop }))
vi.mock('@/features/printer/printer-sink', () => ({ isNativeApp: m.isNativeApp }))

const INSTALL_ID = '6f1c9d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f'
const SHOP_ID = '00000000-0000-4000-8000-000000000500'
const NOW = Date.parse('2026-10-09T10:00:00+07:00')
const MIN = 60_000
const HOUR = 60 * MIN
const HEARTBEAT_AT_KEY = 'my-biller:heartbeat-at'
const BACKOFF_KEY = 'my-biller:heartbeat-backoff-until'
const HEARTBEAT_URL = `${DEFAULT_SYNC_URL}/heartbeat`
const CONNECTION = {
  key: 'connection',
  shopId: SHOP_ID,
  token: 't'.repeat(43),
  syncUrl: 'https://sync.example.com',
}

let fetchMock: Mock
let stopHeartbeat: (() => void) | undefined
let visibility: DocumentVisibilityState
let onLine: boolean
let standalone: boolean

const pairingRow = (expiresAt: number) => ({
  key: 'pairing' as const,
  attemptId: '00000000-0000-4000-8000-000000000777',
  hasLocalLedger: false,
  localLedgerRows: 0,
  connectionSaved: false,
  expiresAt,
})

function setPairing(row: ReturnType<typeof pairingRow> | undefined) {
  m.getDevicePairingState.mockResolvedValue(row)
  m.deviceStateGet.mockImplementation(async (key: string) => (key === 'pairing' ? row : undefined))
}

function startHeartbeat(): () => void {
  const stop = startUnpairedHeartbeat()
  stopHeartbeat = stop
  return stop
}

const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
  visibility = 'visible'
  onLine = true
  standalone = false
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => onLine })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
  }))
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)

  m.ordersCount.mockReset().mockResolvedValue(7)
  m.customersCount.mockReset().mockResolvedValue(3)
  m.deviceStateGet.mockReset().mockResolvedValue(undefined)
  m.getDeviceConnection.mockReset().mockResolvedValue(undefined)
  m.getDevicePairingState.mockReset().mockResolvedValue(undefined)
  m.getOrCreateInstallId.mockReset().mockResolvedValue(INSTALL_ID)
  m.getLedgerOverview.mockReset().mockResolvedValue({ totals: { debtTotal: 12_000 }, counts: {} })
  m.getShop.mockReset().mockResolvedValue({ name: 'Quán Bún' })
  m.isNativeApp.mockReset().mockReturnValue(false)
})

afterEach(() => {
  abortUnpairedHeartbeat()
  stopHeartbeat?.()
  stopHeartbeat = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'onLine')
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('điều kiện gửi heartbeat của máy chưa ghép', () => {
  it('máy đã ghép thì không gửi và không quét sổ', async () => {
    m.getDeviceConnection.mockResolvedValue(CONNECTION)

    await sendUnpairedHeartbeat(15 * MIN)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.getLedgerOverview).not.toHaveBeenCalled()
  })

  it('đang mất mạng thì không gửi và không quét sổ', async () => {
    onLine = false

    await sendUnpairedHeartbeat(15 * MIN)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.getLedgerOverview).not.toHaveBeenCalled()
  })

  it('mốc gửi còn mới trong khoảng freshMs thì không gửi, quá khoảng đó thì gửi', async () => {
    localStorage.setItem(HEARTBEAT_AT_KEY, String(NOW - 10 * MIN))
    await sendUnpairedHeartbeat(15 * MIN)
    expect(fetchMock).not.toHaveBeenCalled()

    localStorage.setItem(HEARTBEAT_AT_KEY, String(NOW - 16 * MIN))
    await sendUnpairedHeartbeat(15 * MIN)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('đang có khoá ghép còn hạn thì không gửi', async () => {
    setPairing(pairingRow(NOW + MIN))

    await sendUnpairedHeartbeat(15 * MIN)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('khoá ghép đã hết hạn thì vẫn gửi', async () => {
    setPairing(pairingRow(NOW - 1))

    await sendUnpairedHeartbeat(15 * MIN)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('máy chưa đặt tên vẫn gửi heartbeat', async () => {
    await sendUnpairedHeartbeat(15 * MIN)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies()[0].installId).toBe(INSTALL_ID)
  })

  it('kiểm lại kết nối ngay trước khi gửi: vừa ghép xong thì không gửi', async () => {
    let reads = 0
    m.getDeviceConnection.mockImplementation(async () => (reads++ === 0 ? undefined : CONNECTION))

    await sendUnpairedHeartbeat(15 * MIN)

    expect(reads).toBeGreaterThanOrEqual(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('nội dung và cách gửi heartbeat', () => {
  it('body đúng các khoá của HeartbeatSchema, số đơn và số khách lấy bằng count()', async () => {
    await sendUnpairedHeartbeat(15 * MIN)

    const body = bodies()[0]
    expect(() => HeartbeatSchema.parse(body)).not.toThrow()
    expect(body).toEqual({
      installId: INSTALL_ID,
      shopName: 'Quán Bún',
      appVersion: version,
      platform: 'browser',
      orderCount: 7,
      customerCount: 3,
      debtTotal: 12_000,
    })
    expect(m.ordersCount).toHaveBeenCalledTimes(1)
    expect(m.customersCount).toHaveBeenCalledTimes(1)
  })

  it('tên quán cắt còn tối đa 80 ký tự', async () => {
    m.getShop.mockResolvedValue({ name: 'a'.repeat(120) })

    await sendUnpairedHeartbeat(15 * MIN)

    expect(bodies()[0].shopName).toHaveLength(80)
  })

  it.each([
    { name: 'APK thì platform là apk', native: true, standalone: false, expected: 'apk' },
    { name: 'APK chạy standalone vẫn là apk', native: true, standalone: true, expected: 'apk' },
    { name: 'PWA chạy standalone là pwa', native: false, standalone: true, expected: 'pwa' },
    { name: 'trình duyệt thường là browser', native: false, standalone: false, expected: 'browser' },
  ])('$name', async ({ native, standalone: isStandalone, expected }) => {
    m.isNativeApp.mockReturnValue(native)
    standalone = isStandalone

    await sendUnpairedHeartbeat(15 * MIN)

    expect(bodies()[0].platform).toBe(expected)
  })

  it('gửi POST tới Worker đã phân giải, kèm keepalive và AbortSignal', async () => {
    await sendUnpairedHeartbeat(15 * MIN)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(HEARTBEAT_URL)
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.signal).toBeDefined()
  })
})

describe('kết quả gửi heartbeat', () => {
  it('204 ghi mốc gửi, và lượt sau trong 15 phút không gửi lại', async () => {
    await sendUnpairedHeartbeat(15 * MIN)
    expect(localStorage.getItem(HEARTBEAT_AT_KEY)).toBe(String(NOW))

    await sendUnpairedHeartbeat(15 * MIN)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'HTTP 500 không ghi mốc, không ném, giữ body để gửi lại',
      fail: () => fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })),
    },
    {
      name: 'fetch reject vì mất mạng không ghi mốc, không ném, giữ body để gửi lại',
      fail: () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')),
    },
  ])('$name', async ({ fail }) => {
    fail()

    await expect(sendUnpairedHeartbeat(15 * MIN)).resolves.toBeUndefined()
    expect(localStorage.getItem(HEARTBEAT_AT_KEY)).toBeNull()

    m.customersCount.mockResolvedValue(9)
    await retryPendingHeartbeat()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies()[1]).toEqual(bodies()[0])
    expect(bodies()[1].customerCount).toBe(3)
  })

  it('429 lùi 60 giây: trong khoảng lùi không gửi, body chờ được gửi lại sau khi hết lùi', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
    await sendUnpairedHeartbeat(15 * MIN)

    const backoffUntil = Number(localStorage.getItem(BACKOFF_KEY))
    expect(Math.abs(backoffUntil - (NOW + MIN))).toBeLessThan(1_000)

    await sendUnpairedHeartbeat(15 * MIN)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(MIN)
    await retryPendingHeartbeat()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies()[1]).toEqual(bodies()[0])
  })

  it.each([400, 413])('%i bỏ body: focus hay có mạng lại không gửi lại body bị từ chối', async (status) => {
    startHeartbeat()
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    await sendUnpairedHeartbeat(15 * MIN)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fire(document, 'visibilitychange')
    fire(window, 'online')
    await retryPendingHeartbeat()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(HEARTBEAT_AT_KEY)).toBeNull()
  })

  it('sau khi huỷ heartbeat đang bay, body của lượt đó không được gửi lại', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const inFlight = sendUnpairedHeartbeat(15 * MIN)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    abortUnpairedHeartbeat()
    await expect(inFlight).resolves.toBeUndefined()

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal?.aborted).toBe(true)

    await retryPendingHeartbeat()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('lịch gửi khi app đang mở', () => {
  it('lượt mở app chạy sau 3 giây, đọc mã cài đặt ngay và lấy debtTotal từ sổ', async () => {
    startHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(m.getOrCreateInstallId).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_999)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(HEARTBEAT_URL)
    expect(bodies()[0].debtTotal).toBe(12_000)
  })

  it('mốc còn mới 15 phút thì lượt mở app bỏ qua và không quét sổ', async () => {
    localStorage.setItem(HEARTBEAT_AT_KEY, String(NOW - 10 * MIN))
    startHeartbeat()

    await vi.advanceTimersByTimeAsync(3_000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.getLedgerOverview).not.toHaveBeenCalled()
  })

  it('lịch mỗi giờ: trong 6 giờ không gửi và không quét sổ lại, quá 6 giờ thì gửi và quét sổ', async () => {
    startHeartbeat()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.getLedgerOverview).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(6 * HOUR - 3_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.getLedgerOverview).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(HOUR)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(m.getLedgerOverview).toHaveBeenCalledTimes(2)
  })

  it.each([
    { name: 'online', target: () => window },
    { name: 'visibilitychange', target: () => document },
  ])(
    '$name chỉ gửi lại body đang chờ, không dựng body mới và không quét sổ',
    async ({ name, target }) => {
      startHeartbeat()
      fire(target(), name)
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(m.getLedgerOverview).not.toHaveBeenCalled()

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
      await sendUnpairedHeartbeat(15 * MIN)
      expect(m.getLedgerOverview).toHaveBeenCalledTimes(1)
      expect(m.customersCount).toHaveBeenCalledTimes(1)

      m.customersCount.mockResolvedValue(9)
      fire(target(), name)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

      expect(bodies()[1]).toEqual(bodies()[0])
      expect(m.getLedgerOverview).toHaveBeenCalledTimes(1)
      expect(m.customersCount).toHaveBeenCalledTimes(1)
    },
  )

  it('hàm dừng gỡ hẹn giờ và lắng nghe, sau đó không gửi nữa', async () => {
    const stop = startHeartbeat()
    stop()
    stopHeartbeat = undefined

    await vi.advanceTimersByTimeAsync(7 * HOUR)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gọi start hai lần chỉ đăng ký một lần lắng nghe online', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    startHeartbeat()
    const stopSecond = startUnpairedHeartbeat()
    stopSecond()

    expect(addSpy.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1)
    addSpy.mockRestore()
  })
})

describe('heartbeat ngay sau khi tự huỷ ghép', () => {
  it('xoá mốc ngay và gửi heartbeat một lần, không chờ 15 phút', async () => {
    localStorage.setItem(HEARTBEAT_AT_KEY, String(NOW - MIN))

    heartbeatAfterLeave()
    expect(localStorage.getItem(HEARTBEAT_AT_KEY)).toBeNull()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(HEARTBEAT_URL)
    expect(bodies()[0].installId).toBe(INSTALL_ID)
  })
})
