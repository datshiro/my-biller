import { z } from 'zod'

/**
 * Nhịp báo của máy chưa ghép: chỉ siêu dữ liệu và số lượng, không một dòng đơn hay tên khách nào.
 * `.strict()` để một bản app sau lỡ gửi thêm khoá thì bị từ chối, chứ không âm thầm lọt dữ liệu lên.
 */
export const HeartbeatSchema = z
  .object({
    installId: z.string().uuid(),
    /** Được phép rỗng: tên quán ở Cài đặt không bắt buộc. */
    shopName: z.string().max(80),
    appVersion: z.string().max(20),
    platform: z.enum(['apk', 'pwa', 'browser']),
    orderCount: z.number().int().nonnegative().max(10_000_000),
    customerCount: z.number().int().nonnegative().max(10_000_000),
    debtTotal: z.number().int().nonnegative().max(1_000_000_000_000),
  })
  .strict()

export type Heartbeat = z.infer<typeof HeartbeatSchema>

export const HEARTBEAT_MAX_BYTES = 2048

/** D1 gói Free cho 50 truy vấn mỗi lần gọi; một lô reconcile phải nằm gọn trong đó. */
export const RECONCILE_MAX_IDS = 20
export const ADMIN_SHOPS_MAX_LIMIT = 20

export type DeviceOverview = {
  id: string
  letter: string
  label: string
  createdAt: number
  revokedAt: number | null
  lastSeenAt: number | null
  pulledSeq: number | null
  rewoundAt: number | null
}

export type ShopSummary = {
  /** Gồm cả đơn huỷ, như số dòng `orders` ở Đối soát. */
  orderCount: number
  customerCount: number
  debtTotal: number
  revenue: number
}

export type ShopOverview = {
  shopId: string
  createdAt: number
  shopName: string | null
  latestSeq: number
  devices: DeviceOverview[]
  summary: ShopSummary
}

export type ShopDebt = {
  customerGid: string
  name: string | null
  total: number
  orderCount: number
  oldestAt: number
}

export type ShopDetail = ShopOverview & { debts: ShopDebt[] }

export type AdminShopsPage = {
  shops: (ShopOverview | { shopId: string; error: string })[]
  next: string | null
}

export type AdminDataRow = {
  entityKey: string
  updatedSeq: number
  after: unknown
  refs: unknown
}

export type AdminDataPage = { rows: AdminDataRow[]; next: number | null }

export type HeartbeatRecord = Heartbeat & {
  firstSeenAt: number
  lastSeenAt: number
  pairedShopId: string | null
  pairedAt: number | null
}

export type UnpairedPage = { devices: HeartbeatRecord[]; total: number; new24h: number }

export type ReconcileSkipReason = 'invalid-id' | 'not-initialized' | 'id-mismatch'

export type ReconcileResult = {
  registered: number
  alreadyIndexed: number
  skipped: { id: string; reason: ReconcileSkipReason }[]
}
