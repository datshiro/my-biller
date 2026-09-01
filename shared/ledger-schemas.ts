import { z } from 'zod'

const Id = z.number().int().positive()
const Timestamp = z.number().int()
const Money = z.number().int().nonnegative()
const PositiveMoney = z.number().int().positive()
const Gid = z.string().uuid()

/** IndexedDB không dùng boolean làm khoá chỉ mục, nên cờ có index được lưu bằng 0/1. */
const Flag = z.union([z.literal(0), z.literal(1)])

export const LedgerTableSchema = z.enum([
  'settings',
  'itemGroups',
  'items',
  'customers',
  'customerPrices',
  'orders',
  'orderLines',
  'payments',
  'expenseCategories',
  'expenses',
])

export type LedgerTableName = z.infer<typeof LedgerTableSchema>
export const LEDGER_TABLE_NAMES = LedgerTableSchema.options

export const ShopSettingsSchema = z.object({
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  footerNote: z.string(),
})

export const AppStateSchema = z.object({
  lastBackupAt: Timestamp.nullable(),
  seededExpenseCategories: z.boolean(),
})

export const SettingRowSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('shop'), value: ShopSettingsSchema }),
  z.object({ key: z.literal('app'), value: AppStateSchema }),
])

export const ItemGroupSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  name: z.string().min(1),
  sortOrder: z.number().int(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const ItemSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  name: z.string().min(1),
  groupId: Id.nullable(),
  unit: z.string().trim(),
  unitPrice: Money,
  costPrice: Money.nullable(),
  isActive: Flag,
  note: z.string().default(''),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const CustomerSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  name: z.string().min(1),
  phone: z.string(),
  address: z.string(),
  note: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const CustomerPriceSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  customerId: Id,
  itemId: Id,
  unitPrice: Money,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const OrderSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  code: z.string().min(1),
  originalCode: z.string().default(''),
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

export const OrderLineSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  orderId: Id,
  itemId: Id.nullable(),
  name: z.string().min(1),
  unit: z.string(),
  unitPrice: Money,
  costPrice: Money.nullable(),
  qty: z.number().positive(),
  amount: Money,
  // Không index nên Dexie không cần bump `version` — bump là đóng dấu `schemaGen` mới lên
  // `deviceState` và tự chặn app của chính máy đó khi hai bản JS cùng sống (registerType: 'prompt').
  // `.default('')` giữ file sao lưu cũ nhập lại được, và giữ event từ máy chưa cập nhật đi qua.
  note: z.string().default(''),
})

export const PaymentSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  orderId: Id,
  /** 0 = tiền đã thu nhưng hiện chưa trừ vào đơn nào. */
  allocatedOrderId: z.number().int().nonnegative(),
  customerId: Id.nullable(),
  amount: PositiveMoney,
  method: z.enum(['cash', 'transfer']),
  paidAt: Timestamp,
  note: z.string(),
  unallocatedStatus: z.enum(['pending', 'refunded', 'discarded']).optional(),
  resolutionNote: z.string().optional(),
})

export const ExpenseCategorySchema = z.object({
  id: Id.optional(),
  gid: Gid,
  name: z.string().min(1),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const ExpenseSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  categoryId: Id.nullable(),
  amount: PositiveMoney,
  note: z.string(),
  spentAt: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const LedgerRowSchemaByTable = {
  settings: SettingRowSchema,
  itemGroups: ItemGroupSchema,
  items: ItemSchema,
  customers: CustomerSchema,
  customerPrices: CustomerPriceSchema,
  orders: OrderSchema,
  orderLines: OrderLineSchema,
  payments: PaymentSchema,
  expenseCategories: ExpenseCategorySchema,
  expenses: ExpenseSchema,
} as const

/** Payload bền vững trên Worker: bỏ id và khoá ngoại cục bộ; quan hệ nằm trong `refs`. */
export const LedgerPayloadSchemaByTable = {
  settings: SettingRowSchema,
  itemGroups: ItemGroupSchema.omit({ id: true }),
  items: ItemSchema.omit({ id: true, groupId: true }),
  customers: CustomerSchema.omit({ id: true }),
  customerPrices: CustomerPriceSchema.omit({ id: true, customerId: true, itemId: true }),
  orders: OrderSchema.omit({ id: true, customerId: true }),
  orderLines: OrderLineSchema.omit({ id: true, orderId: true, itemId: true }),
  payments: PaymentSchema.omit({ id: true, orderId: true, allocatedOrderId: true, customerId: true }),
  expenseCategories: ExpenseCategorySchema.omit({ id: true }),
  expenses: ExpenseSchema.omit({ id: true, categoryId: true }),
} as const

export function safeParseLedgerPayload(table: LedgerTableName, payload: unknown) {
  const schema = LedgerPayloadSchemaByTable[table] as z.ZodType<Record<string, unknown>>
  return schema.safeParse(payload)
}

export function safeParseLedgerRow(table: LedgerTableName, row: unknown) {
  const schema = LedgerRowSchemaByTable[table] as z.ZodType<Record<string, unknown>>
  return schema.safeParse(row)
}
