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

/**
 * Oplog không bao giờ được dọn, mỗi lần lưu thông tin quán chép logo hai lần (before + after), và máy mới ghép kéo lại
 * từ đầu — nên logo phải là PNG đen trắng nhỏ, không phải ảnh gốc.
 */
export const SHOP_LOGO_MAX_CHARS = 40_000

export const LabelWatermarkSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(['center', 'corner']),
  strength: z.enum(['light', 'medium', 'dark']),
  /**
   * Logo chìm (`position: 'center'`) căn giữa tem hay dồn về nửa phải. Là trường riêng chứ không phải một giá trị
   * `position` mới: bản 2.10.0 gặp giá trị enum lạ thì không parse nổi bản ghi shop và kẹt đồng bộ, còn trường lạ
   * thì chỉ bị bỏ qua (in căn giữa).
   */
  align: z.enum(['center', 'right']).default('center'),
})

export const ShopSettingsSchema = z.object({
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  footerNote: z.string(),
  logo: z
    .string()
    .max(SHOP_LOGO_MAX_CHARS)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .default(null),
  labelWatermark: LabelWatermarkSchema.default(() => ({
    enabled: false,
    position: 'center' as const,
    strength: 'light' as const,
    align: 'center' as const,
  })),
})

export const AppStateSchema = z.object({
  lastBackupAt: Timestamp.nullable(),
  seededExpenseCategories: z.boolean(),
})

export const SettingRowSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('shop'), value: ShopSettingsSchema }),
  z.object({ key: z.literal('app'), value: AppStateSchema }),
])

/**
 * Thực đơn tuỳ chọn kiểu cũ, nằm ngay trong nhóm món (Đường, Đá…): trong một nhóm chỉ chọn được một lựa chọn.
 * Máy bản cũ chỉ đọc được dạng này nên nó vẫn sống song song với `OptionGroupRowSchema`.
 */
export const LegacyOptionGroupSchema = z.object({
  name: z.string().trim().min(1),
  choices: z.array(z.string().trim().min(1)).min(1),
})

/** Topping trong thực đơn của nhóm món; `price` là tiền cộng thêm cho MỖI một phần topping. */
export const ToppingMenuItemSchema = z.object({
  name: z.string().trim().min(1),
  price: Money,
})

/**
 * Topping đã chọn trên một dòng đơn. `unitPrice` là giá LÚC BÁN, chép thẳng vào dòng: giá thực đơn đổi
 * về sau thì đơn cũ không được đổi theo.
 */
export const LineToppingSchema = z.object({
  name: z.string().trim().min(1),
  unitPrice: Money,
  qty: z.number().int().positive(),
})

/**
 * Không `.default`, cùng lẽ với `OrderSchema.serviceMode`: máy 2.19.0 bỏ hai trường này khi đọc rồi ghi lại
 * hàng thiếu chúng, và đồng bộ parse hàng kéo về trước khi lưu — mặc định ở schema sẽ biến "không biết" thành
 * giá trị thật để máy mới đẩy đè lên. Mặc định chỉ điền lúc đọc (`src/db/db.ts`).
 */
export const ItemKindSchema = z.enum(['item', 'topping'])

const OPTION_GROUP_REFS_MAX = 20

const OptionGroupGids = z
  .array(Gid)
  .max(OPTION_GROUP_REFS_MAX)
  .refine((gids) => new Set(gids).size === gids.length, 'Một nhóm lựa chọn chỉ gắn một lần.')

export const ItemGroupSchema = z.object({
  id: Id.optional(),
  gid: Gid,
  name: z.string().min(1),
  sortOrder: z.number().int(),
  // Không index nên Dexie không cần bump `version`; `.default` giữ file sao lưu và event cũ đi qua được.
  optionGroups: z.array(LegacyOptionGroupSchema).default(() => []),
  toppingMenu: z.array(ToppingMenuItemSchema).default(() => []),
  optionGroupGids: OptionGroupGids.optional(),
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
  // Món topping đang bán (`isActive: 1`) vẫn hiện trên lưới như món thường; `isActive: 0` là chỉ bán kèm qua
  // nhóm topping — app cũ lọc lưới theo `isActive` nên tự ẩn nó mà không cần trường riêng.
  kind: ItemKindSchema.optional(),
  optionGroupGids: OptionGroupGids.optional(),
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
  // Không `.default`: máy 2.19.0 đọc đơn rồi ghi lại hàng thiếu trường này, nên mặc định lúc đọc sẽ
  // để máy mới đẩy 'dine-in' đè lên đơn mang về. Thiếu trường = đơn cũ, không in gì. Đặt lúc tạo rồi
  // bất biến: Worker dựng `put` của đơn từ bản đã lưu và không nhận trường này.
  serviceMode: z.enum(['dine-in', 'takeaway']).optional(),
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
  /** Nhãn tuỳ chọn đã chọn (Ít đường, Không đá…). Chỉ lưu nhãn; nhóm và luật loại trừ nằm ở thực đơn. */
  options: z.array(z.string().trim().min(1)).default(() => []),
  toppings: z.array(LineToppingSchema).default(() => []),
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

const OPTION_GROUP_ITEMS_MAX = 30
const OPTION_LABEL_MAX = 40

const ChoiceListSchema = z
  .array(z.string().trim().min(1).max(OPTION_LABEL_MAX))
  .min(1)
  .max(OPTION_GROUP_ITEMS_MAX)
  .refine((choices) => new Set(choices).size === choices.length, 'Lựa chọn trong một nhóm không được trùng.')

const ToppingListSchema = z
  .array(z.object({ itemGid: Gid, price: Money.nullable() }))
  .min(1)
  .max(OPTION_GROUP_ITEMS_MAX)
  .refine(
    (toppings) => new Set(toppings.map((topping) => topping.itemGid)).size === toppings.length,
    'Một món topping chỉ có mặt một lần trong nhóm.',
  )

const optionGroupFields = {
  gid: Gid,
  name: z.string().trim().min(1).max(OPTION_LABEL_MAX),
  required: Flag,
  /** `null` hoặc 1 là chọn-một; lớn hơn 1 là chọn-nhiều (ghi chú nhanh). */
  maxSelect: z.number().int().min(1).max(OPTION_GROUP_ITEMS_MAX).nullable(),
  defaultChoice: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: Flag,
  createdAt: Timestamp,
  updatedAt: Timestamp,
}

const ChoiceGroupSchema = z.object({ ...optionGroupFields, kind: z.literal('choice'), choices: ChoiceListSchema })
// `price: null` = lấy giá bán của chính món topping; có số là giá riêng khi bán kèm trong nhóm này.
const ToppingGroupSchema = z.object({ ...optionGroupFields, kind: z.literal('topping'), toppings: ToppingListSchema })

type OptionGroupShape = { maxSelect: number | null; defaultChoice: string | null } & (
  | { kind: 'choice'; choices: string[] }
  | { kind: 'topping'; toppings: unknown[] }
)

function checkOptionGroup(group: OptionGroupShape, ctx: z.RefinementCtx): void {
  const count = group.kind === 'choice' ? group.choices.length : group.toppings.length
  if (group.maxSelect !== null && group.maxSelect > count) {
    ctx.addIssue({ code: 'custom', path: ['maxSelect'], message: 'Chọn tối đa nhiều hơn số lựa chọn có.' })
  }
  if (group.defaultChoice !== null && (group.kind !== 'choice' || !group.choices.includes(group.defaultChoice))) {
    ctx.addIssue({ code: 'custom', path: ['defaultChoice'], message: 'Lựa chọn mặc định không có trong nhóm.' })
  }
}

/**
 * Nhóm lựa chọn dùng chung, gắn vào món hoặc nhóm món qua `optionGroupGids`. KHÔNG nằm trong `LedgerTableSchema`:
 * máy bản cũ kẹt đồng bộ khi gặp bảng lạ trong sổ chính, nên bảng này đi luồng danh mục riêng.
 */
export const OptionGroupRowSchema = z
  .discriminatedUnion('kind', [
    ChoiceGroupSchema.extend({ id: Id.optional() }),
    ToppingGroupSchema.extend({ id: Id.optional() }),
  ])
  .superRefine(checkOptionGroup)

export const OptionGroupPayloadSchema = z
  .discriminatedUnion('kind', [ChoiceGroupSchema, ToppingGroupSchema])
  .superRefine(checkOptionGroup)

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
