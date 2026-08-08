import { z } from 'zod'

const Id = z.number().int().positive()
const Timestamp = z.number().int()
const Money = z.number().int().nonnegative()
const PositiveMoney = z.number().int().positive()

/**
 * IndexedDB không nhận `true/false` làm khoá chỉ mục — bản ghi có giá trị boolean ở trường được index
 * sẽ bị bỏ khỏi index một cách âm thầm. Nên cờ nào có index thì lưu 0/1.
 */
const Flag = z.union([z.literal(0), z.literal(1)])

export const ShopSettingsSchema = z.object({
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  footerNote: z.string(),
})

/** Trạng thái của app, khác với thông tin quán ở chỗ người bán không tự gõ ra. */
export const AppStateSchema = z.object({
  /** `null` = chưa sao lưu lần nào. Dùng cho banner nhắc sao lưu. */
  lastBackupAt: Timestamp.nullable(),
  /**
   * Đã nạp loại chi phí mặc định một lần rồi. Không suy ra từ "bảng loại đang rỗng" được: người bán
   * xoá sạch loại vì không muốn dùng thì lần mở app sau chúng sẽ mọc lại.
   */
  seededExpenseCategories: z.boolean(),
})

export const SettingRowSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('shop'), value: ShopSettingsSchema }),
  z.object({ key: z.literal('app'), value: AppStateSchema }),
])

export const ItemGroupSchema = z.object({
  id: Id.optional(),
  name: z.string().min(1),
  sortOrder: z.number().int(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const ItemSchema = z.object({
  id: Id.optional(),
  name: z.string().min(1),
  groupId: Id.nullable(),
  unit: z.string(),
  unitPrice: Money,
  costPrice: Money.nullable(),
  isActive: Flag,
  // `.default('')` để bản ghi tạo trước khi có trường này vẫn đọc/sửa được, không cần nâng version Dexie
  // (trường không nằm trong index nên `stores()` giữ nguyên).
  note: z.string().default(''),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const CustomerSchema = z.object({
  id: Id.optional(),
  name: z.string().min(1),
  phone: z.string(),
  address: z.string(),
  note: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

/**
 * Giá riêng của một khách cho một mặt hàng. `0` là **giá thật** (hàng biếu, khuyến mãi), không phải
 * "chưa đặt" — chưa đặt thì đơn giản là không có dòng nào ở đây.
 */
export const CustomerPriceSchema = z.object({
  id: Id.optional(),
  customerId: Id,
  itemId: Id,
  unitPrice: Money,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const OrderSchema = z.object({
  id: Id.optional(),
  code: z.string().min(1),
  customerId: Id.nullable(),
  customerName: z.string(),
  subtotal: Money,
  discount: Money,
  surcharge: Money,
  total: Money,
  paidAmount: Money,
  status: z.enum(['paid', 'partial', 'unpaid', 'void']),
  soldAt: Timestamp,
  note: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

/** name/unit/unitPrice/costPrice là ảnh chụp lúc bán — sửa giá mặt hàng không được làm sai phiếu cũ. */
export const OrderLineSchema = z.object({
  id: Id.optional(),
  orderId: Id,
  itemId: Id.nullable(),
  name: z.string().min(1),
  unit: z.string(),
  unitPrice: Money,
  costPrice: Money.nullable(),
  qty: z.number().positive(),
  amount: Money,
})

export const PaymentSchema = z.object({
  id: Id.optional(),
  orderId: Id,
  customerId: Id.nullable(),
  amount: PositiveMoney,
  method: z.enum(['cash', 'transfer']),
  paidAt: Timestamp,
  note: z.string(),
})

export const ExpenseCategorySchema = z.object({
  id: Id.optional(),
  name: z.string().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const ExpenseSchema = z.object({
  id: Id.optional(),
  categoryId: Id.nullable(),
  amount: PositiveMoney,
  note: z.string(),
  spentAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

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
function fillPriceBookOfV1(raw: unknown): unknown {
  const file = raw as { version?: unknown; data?: object } | null
  if (file?.version !== 1 || typeof file.data !== 'object' || file.data === null) return raw
  return { ...file, data: { customerPrices: [], ...file.data } }
}

/**
 * Đúng 5 trường này — Phase 9 dùng lại y nguyên.
 * Khi đổi schema sau này, `version` là chỗ rẽ nhánh để file sao lưu cũ vẫn nhập được.
 */
export const BackupFileSchema = z.preprocess(
  fillPriceBookOfV1,
  z.object({
    app: z.literal('my-biller'),
    version: z.union([z.literal(1), z.literal(2)]),
    appVersion: z.string(),
    exportedAt: z.string(),
    data: BackupDataSchema,
  }),
)

export type ShopSettings = z.infer<typeof ShopSettingsSchema>
export type AppState = z.infer<typeof AppStateSchema>
export type SettingRow = z.infer<typeof SettingRowSchema>
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
