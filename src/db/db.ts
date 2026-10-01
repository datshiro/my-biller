import Dexie, { type Table, type Transaction } from 'dexie'
import { blockDb } from './db-block'
import { newGid } from '@/domain/gid'
import type {
  Customer,
  CustomerPrice,
  DeviceState,
  Expense,
  ExpenseCategory,
  Item,
  ItemGroup,
  Order,
  OrderLine,
  Payment,
  SettingRow,
} from '@/domain/schema'
import { DeviceSchemaStateSchema } from '@/domain/schema'
import type { OutboxRow } from './sync/outbox'
import { installOutboxHooks } from './sync/outbox'

type Stamped = { createdAt?: number; updatedAt?: number }
type MigratedRow = { id?: number; gid?: string; createdAt?: number; updatedAt?: number }

export const CURRENT_SCHEMA_GEN = 5

async function backfillGids(
  transaction: Transaction,
  tableName: string,
  preserveTimestamps: boolean,
): Promise<void> {
  const table = transaction.table<MigratedRow, number>(tableName)
  const rows = await table.toArray()
  if (rows.length === 0) return

  const migrated = rows.map((row) => ({ ...row, gid: row.gid ?? newGid() }))
  await table.bulkPut(migrated)

  if (preserveTimestamps) {
    await table.bulkPut(
      migrated.map((row, index) => ({
        ...row,
        createdAt: rows[index]?.createdAt,
        updatedAt: rows[index]?.updatedAt,
      })),
    )
  }

  const stored = await table.toArray()
  const gids = new Set(stored.map((row) => row.gid))
  if (stored.some((row) => !row.gid) || gids.size !== stored.length) {
    throw new Error(`Không thể cấp gid duy nhất cho bảng ${tableName}.`)
  }
}

/**
 * Transaction ghi lại đúng nguyên văn một bản đã chụp (cuộn ngược thao tác bị từ chối). Dexie chỉ đưa
 * cho hook `updating` phần khác nhau, nên bản dán lại có `updatedAt` trùng bản hiện tại sẽ bị đóng dấu
 * giờ mới và không còn khớp `after` của thao tác trước nó.
 */
export const verbatimWrites = new WeakSet<Transaction>()

/**
 * `createdAt` chỉ được đặt khi bản ghi chưa có — nhập file sao lưu phải giữ nguyên mốc thời gian gốc,
 * không được đóng dấu ngày nhập lên toàn bộ dữ liệu cũ.
 */
function stampTimestamps<T extends Stamped>(table: Table<T, number>): void {
  table.hook('creating', (_primKey, obj) => {
    const now = Date.now()
    const row = obj as Stamped
    row.createdAt ??= now
    row.updatedAt ??= now
  })

  table.hook('updating', (modifications, _primKey, _obj, transaction) =>
    'updatedAt' in (modifications as object) || verbatimWrites.has(transaction)
      ? undefined
      : { updatedAt: Date.now() },
  )
}

/**
 * Dòng đơn và nhóm món ghi TRƯỚC khi có trường mảng mới (tuỳ chọn, topping, thực đơn của nhóm) nằm trong
 * IndexedDB mà không có trường đó, và đổi `version` chỉ để vá chúng là đóng dấu `schemaGen` mới lên
 * máy đang chạy. Điền mảng rỗng lúc ĐỌC để mọi chỗ dùng được tin kiểu: `line.toppings.reduce` không
 * được nổ trên phiếu của đơn cũ.
 */
function defaultArrayFields<T extends object>(table: Table<T, number>, fields: readonly (keyof T & string)[]): void {
  table.hook('reading', (obj) => {
    const row = obj as Record<string, unknown>
    const missing = fields.filter((field) => !Array.isArray(row[field]))
    return missing.length === 0 ? obj : { ...obj, ...Object.fromEntries(missing.map((field) => [field, []])) }
  })
}

export class BillerDb extends Dexie {
  settings!: Table<SettingRow, string>
  deviceState!: Table<DeviceState, string>
  itemGroups!: Table<ItemGroup, number>
  items!: Table<Item, number>
  customers!: Table<Customer, number>
  customerPrices!: Table<CustomerPrice, number>
  orders!: Table<Order, number>
  orderLines!: Table<OrderLine, number>
  payments!: Table<Payment, number>
  expenseCategories!: Table<ExpenseCategory, number>
  expenses!: Table<Expense, number>
  outbox!: Table<OutboxRow, number>

  constructor(name = 'my-biller') {
    super(name)

    // KHÔNG BAO GIỜ sửa version(1). Đổi schema về sau phải thêm version(n+1).stores(...).upgrade(...)
    // vì Worker không thể tự nâng IndexedDB nằm trên từng máy người dùng.
    this.version(1).stores({
      settings: 'key',
      itemGroups: '++id, name, sortOrder',
      items: '++id, name, groupId, isActive',
      customers: '++id, name, phone',
      orders: '++id, &code, customerId, soldAt, status',
      orderLines: '++id, orderId, itemId',
      payments: '++id, orderId, customerId, paidAt',
      expenseCategories: '++id, name',
      expenses: '++id, categoryId, spentAt',
    })

    // Bảng thêm mới thuần, không bản ghi cũ nào cần biến đổi → không cần `.upgrade()`.
    // `&[customerId+itemId]` là index ghép **unique**: nó chặn chứ không upsert, nên cửa ghi phải mang
    // `id` cũ theo (`repositories/customer-prices.ts`).
    this.version(2).stores({
      customerPrices: '++id, &[customerId+itemId], customerId, itemId',
    })

    this.version(3)
      .stores({
        deviceState: 'key',
        itemGroups: '++id, name, sortOrder, &gid',
        items: '++id, name, groupId, isActive, &gid',
        customers: '++id, name, phone, &gid',
        customerPrices: '++id, &[customerId+itemId], customerId, itemId, &gid',
        orders: '++id, &code, customerId, soldAt, status, &gid',
        orderLines: '++id, orderId, itemId, &gid',
        payments: '++id, orderId, customerId, paidAt, &gid',
        expenseCategories: '++id, name, &gid',
        expenses: '++id, categoryId, spentAt, &gid',
      })
      .upgrade(async (transaction) => {
        for (const tableName of [
          'itemGroups',
          'items',
          'customers',
          'customerPrices',
          'orders',
          'expenseCategories',
          'expenses',
        ]) {
          await backfillGids(transaction, tableName, true)
        }
        for (const tableName of ['orderLines', 'payments']) {
          await backfillGids(transaction, tableName, false)
        }

        await transaction
          .table<DeviceState, string>('deviceState')
          .put(DeviceSchemaStateSchema.parse({ key: 'schema', schemaGen: 3 }))
      })

    this.version(4)
      .stores({
        payments: '++id, orderId, customerId, paidAt, &gid, allocatedOrderId',
      })
      .upgrade(async (transaction) => {
        const orders = await transaction.table<Order, number>('orders').toArray()
        const voidOrderIds = new Set(
          orders.flatMap((order) =>
            order.status === 'void' && order.id !== undefined ? [order.id] : [],
          ),
        )
        const payments = await transaction.table<Payment, number>('payments').toArray()
        await transaction.table<Payment, number>('payments').bulkPut(
          payments.map((payment) => ({
            ...payment,
            allocatedOrderId: voidOrderIds.has(payment.orderId) ? 0 : payment.orderId,
          })),
        )
        await transaction
          .table<DeviceState, string>('deviceState')
          .put(DeviceSchemaStateSchema.parse({ key: 'schema', schemaGen: 4 }))
      })

    this.version(5)
      .stores({
        outbox: '++id, &eventId, txId, status, [txId+txOrder]',
      })
      .upgrade((transaction) =>
        transaction
          .table<DeviceState, string>('deviceState')
          .put(DeviceSchemaStateSchema.parse({ key: 'schema', schemaGen: 5 })),
      )

    stampTimestamps(this.itemGroups)
    stampTimestamps(this.items)
    stampTimestamps(this.customers)
    stampTimestamps(this.customerPrices)
    stampTimestamps(this.orders)
    stampTimestamps(this.expenseCategories)
    stampTimestamps(this.expenses)
    defaultArrayFields(this.orderLines, ['options', 'toppings'])
    defaultArrayFields(this.itemGroups, ['optionGroups', 'toppingMenu'])
    installOutboxHooks(this)

    // `.upgrade()` không chạy khi IndexedDB được tạo mới thẳng ở version mới nhất.
    this.on('populate', (transaction) =>
      transaction
        .table<DeviceState, string>('deviceState')
        .put(DeviceSchemaStateSchema.parse({ key: 'schema', schemaGen: CURRENT_SCHEMA_GEN })),
    )

    // Một bản JS khác trên cùng máy vừa nâng version. Giữ kết nối thì bản kia treo mãi ở `blocked`;
    // dùng tiếp thì mọi lệnh ghi đều hỏng trong khi màn hình vẫn hiện như thường. Đóng rồi chặn màn
    // là đường duy nhất còn nói thật với người bán.
    this.on('versionchange', () => {
      this.close()
      blockDb('stale-app')
    })

    // Bản mới đang chờ nâng version mà một kết nối cũ không chịu đóng: lượt nâng cấp treo vô hạn (đo
    // trên Chrome thật — 30s vẫn treo, trình duyệt không đóng hộ). Dexie tự đóng kết nối của nó nên
    // hai bản app của chính mình không kẹt nhau; cái này là bảo hiểm cho một kết nối không phải Dexie
    // hoặc một tab đã đơ. Phải nói ra, không thì người bán ngồi nhìn màn đứng.
    this.on('blocked', () => blockDb('other-tab'))

    // Bản JS cũ **mở được** kho đã lên version cao hơn. Đo trên Chrome thật: Dexie thử
    // `open(name, verno*10)`, ăn `VersionError`, rồi tự mở lại **không nêu version** và chạy tiếp với
    // đúng những bảng nó khai — không thấy bảng nào sinh sau. Hậu quả không phải màn trắng mà là mất
    // tiền trong im lặng:
    //   · `collectBackup` gom theo `db.tables` → file sao lưu thiếu hẳn bảng mới, mà vẫn đóng dấu
    //     `lastBackupAt` như một file lành;
    //   · `replaceAllData` xoá cũng theo `db.tables` → bảng mới sống sót qua lần nhập, rồi dòng của nó
    //     bám sang bản ghi khác vừa nhận đúng số id đó. Đo được: giá sỉ 45.000 của một khách nhảy sang
    //     khách khác, món khác, không một lỗi nào.
    // Nên thấy kho có bảng mình không biết thì dừng hẳn, đừng đọc đừng ghi.
    //
    // So theo **tên bảng thật**, không so số version: Dexie có đường sửa schema mở lại ở
    // `idbdb.version + 1`, nên một bản v1 hoàn toàn hợp lệ có thể nằm ở version thật 11 — lấy
    // `11 > 1*10` làm dấu hiệu là chặn nhầm chính mình.
    this.on('ready', async () => {
      const daKhai = new Set(this.tables.map((table) => table.name))
      const laHoac = [...this.backendDB().objectStoreNames].filter((name) => !daKhai.has(name))
      if (laHoac.length > 0) {
        blockDb('stale-app')
        throw new Error(`App cũ hơn dữ liệu trong máy (chưa biết bảng: ${laHoac.join(', ')}).`)
      }

      const schemaState = await this.deviceState.get('schema')
      if (schemaState?.key !== 'schema' || schemaState.schemaGen <= CURRENT_SCHEMA_GEN) return

      blockDb('stale-app')
      throw new Error(
        `App cũ hơn dữ liệu trong máy (schema ${schemaState.schemaGen} > ${CURRENT_SCHEMA_GEN}).`,
      )
    })
  }
}

export const db = new BillerDb()
