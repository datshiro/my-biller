import { z } from 'zod'
import {
  AppStateSchema,
  CustomerPriceSchema,
  CustomerSchema,
  ExpenseCategorySchema,
  ExpenseSchema,
  ItemGroupSchema,
  ItemSchema,
  OrderLineSchema,
  OrderSchema,
  PaymentSchema,
  SettingRowSchema,
  ShopSettingsSchema,
} from '@shared/ledger-schemas'

export {
  AppStateSchema,
  CustomerPriceSchema,
  CustomerSchema,
  ExpenseCategorySchema,
  ExpenseSchema,
  ItemGroupSchema,
  ItemSchema,
  OrderLineSchema,
  OrderSchema,
  PaymentSchema,
  SettingRowSchema,
  ShopSettingsSchema,
} from '@shared/ledger-schemas'

const Id = z.number().int().positive()
const Timestamp = z.number().int()
const Gid = z.string().uuid()

export const DeviceIdentitySchema = z.object({
  key: z.literal('identity'),
  deviceId: Gid,
  label: z.string().trim().min(1),
  letter: z.string().regex(/^[A-Z]$/),
})

export const DeviceSchemaStateSchema = z.object({
  key: z.literal('schema'),
  schemaGen: z.number().int().positive(),
})

export const DeviceConnectionSchema = z.object({
  key: z.literal('connection'),
  shopId: Gid,
  token: z.string().min(32),
  syncUrl: z.string().url(),
})

export const DeviceSyncStateSchema = z.object({
  key: z.literal('sync'),
  lastSeq: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  resyncRequired: z.boolean(),
  lastConnectedAt: Timestamp.nullable(),
})

export const DeviceLeaseSchema = z.object({
  key: z.literal('lease'),
  ownerId: Gid,
  epoch: z.number().int().positive(),
  expiresAt: Timestamp,
})

export const DeviceNoticeSchema = z.object({
  key: z.literal('notice'),
  id: Gid,
  kind: z.enum(['sync', 'revoked']).default('sync'),
  message: z.string().min(1),
  createdAt: Timestamp,
})

export const DeviceWriteBlockSchema = z.object({
  key: z.literal('writeBlock'),
  reason: z.literal('revoked'),
  shopId: Gid.nullable().default(null),
  createdAt: Timestamp,
})

export const DevicePairingLockSchema = z.object({
  key: z.literal('pairing'),
  attemptId: Gid,
  hasLocalLedger: z.boolean(),
  localLedgerRows: z.number().int().nonnegative(),
  connectionSaved: z.boolean(),
  expiresAt: Timestamp,
})

export const DeviceStateSchema = z.discriminatedUnion('key', [
  DeviceIdentitySchema,
  DeviceSchemaStateSchema,
  DeviceConnectionSchema,
  DeviceSyncStateSchema,
  DeviceLeaseSchema,
  DeviceNoticeSchema,
  DeviceWriteBlockSchema,
  DevicePairingLockSchema,
])

/**
 * Trong DB `id` do IndexedDB cấp nên lúc tạo mới còn trống, nhưng trong **file sao lưu** thì bắt buộc:
 * `orderLines.orderId` và `payments.orderId` trỏ theo id, thiếu id là lúc nhập lại IndexedDB cấp số
 * mới và dòng hàng rời khỏi đơn của nó.
 */
export const BackupDataSchema = z.object({
  settings: z.array(SettingRowSchema),
  itemGroups: z.array(ItemGroupSchema.extend({ id: Id })),
  items: z.array(ItemSchema.extend({ id: Id })),
  customers: z.array(CustomerSchema.extend({ id: Id })),
  customerPrices: z.array(CustomerPriceSchema.extend({ id: Id })),
  orders: z.array(OrderSchema.extend({ id: Id })),
  orderLines: z.array(OrderLineSchema.extend({ id: Id })),
  payments: z.array(PaymentSchema.extend({ id: Id })),
  expenseCategories: z.array(ExpenseCategorySchema.extend({ id: Id })),
  expenses: z.array(ExpenseSchema.extend({ id: Id })),
})

/**
 * File `version: 1` ra đời trước bảng giá riêng nên thiếu hẳn khoá `customerPrices`. Bù vào đây, trước
 * khi schema soi `data` — chứ **không** cho trường đó một `.default([])`: `.default()` nuốt luôn file v2
 * bị lược mất bảng giá, và khi đó `version` chỉ còn là chữ trang trí.
 */
function migrateLegacyBackup(raw: unknown): unknown {
  const file = raw as { version?: unknown; data?: Record<string, unknown> } | null
  if (
    (file?.version !== 1 && file?.version !== 2 && file?.version !== 3) ||
    typeof file.data !== 'object' ||
    file.data === null
  ) {
    return raw
  }

  const dataWithPriceBook = file.version === 1 ? { customerPrices: [], ...file.data } : file.data
  const withGid = (rows: unknown) =>
    Array.isArray(rows)
      ? rows.map((row) =>
          typeof row === 'object' && row !== null ? { gid: crypto.randomUUID(), ...row } : row,
        )
      : rows

  const data =
    file.version < 3
      ? {
          ...dataWithPriceBook,
          itemGroups: withGid(dataWithPriceBook.itemGroups),
          items: withGid(dataWithPriceBook.items),
          customers: withGid(dataWithPriceBook.customers),
          customerPrices: withGid(dataWithPriceBook.customerPrices),
          orders: withGid(dataWithPriceBook.orders),
          orderLines: withGid(dataWithPriceBook.orderLines),
          payments: withGid(dataWithPriceBook.payments),
          expenseCategories: withGid(dataWithPriceBook.expenseCategories),
          expenses: withGid(dataWithPriceBook.expenses),
        }
      : dataWithPriceBook

  const voidOrderIds = new Set(
    Array.isArray(data.orders)
      ? data.orders.flatMap((row) => {
          const order = row as { id?: unknown; status?: unknown }
          return order.status === 'void' && typeof order.id === 'number' ? [order.id] : []
        })
      : [],
  )

  return {
    ...file,
    data: {
      ...data,
      payments: Array.isArray(data.payments)
        ? data.payments.map((row) => {
            if (typeof row !== 'object' || row === null) return row
            const payment = row as { orderId?: unknown }
            return {
              ...payment,
              allocatedOrderId:
                typeof payment.orderId === 'number' && !voidOrderIds.has(payment.orderId)
                  ? payment.orderId
                  : 0,
            }
          })
        : data.payments,
    },
  }
}

/**
 * Đúng 5 trường này — Phase 9 dùng lại y nguyên.
 * Khi đổi schema sau này, `version` là chỗ rẽ nhánh để file sao lưu cũ vẫn nhập được.
 */
export const BackupFileSchema = z.preprocess(
  migrateLegacyBackup,
  z.object({
    app: z.literal('my-biller'),
    version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    appVersion: z.string(),
    exportedAt: z.string(),
    data: BackupDataSchema,
  }),
)

export type ShopSettings = z.infer<typeof ShopSettingsSchema>
export type AppState = z.infer<typeof AppStateSchema>
export type SettingRow = z.infer<typeof SettingRowSchema>
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>
export type DeviceSchemaState = z.infer<typeof DeviceSchemaStateSchema>
export type DeviceConnection = z.infer<typeof DeviceConnectionSchema>
export type DeviceSyncState = z.infer<typeof DeviceSyncStateSchema>
export type DeviceLease = z.infer<typeof DeviceLeaseSchema>
export type DeviceNotice = z.infer<typeof DeviceNoticeSchema>
export type DeviceState = z.infer<typeof DeviceStateSchema>
export type ItemGroup = z.infer<typeof ItemGroupSchema>
export type Item = z.infer<typeof ItemSchema>
export type Customer = z.infer<typeof CustomerSchema>
export type CustomerPrice = z.infer<typeof CustomerPriceSchema>
export type Order = z.infer<typeof OrderSchema>
export type OrderLine = z.infer<typeof OrderLineSchema>
export type Payment = z.infer<typeof PaymentSchema>
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>
export type Expense = z.infer<typeof ExpenseSchema>
export type BackupData = z.infer<typeof BackupDataSchema>
export type BackupFile = z.infer<typeof BackupFileSchema>

export const DEFAULT_SHOP: ShopSettings = {
  name: '',
  phone: '',
  address: '',
  footerNote: 'Cảm ơn quý khách!',
}

export const DEFAULT_APP_STATE: AppState = {
  lastBackupAt: null,
  seededExpenseCategories: false,
}
