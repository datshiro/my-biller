import Dexie, { type Table } from 'dexie'
import { blockDb } from './db-block'
import type {
  Customer,
  CustomerPrice,
  Expense,
  ExpenseCategory,
  Item,
  ItemGroup,
  Order,
  OrderLine,
  Payment,
  SettingRow,
} from '@/domain/schema'

type Stamped = { createdAt?: number; updatedAt?: number }

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

  table.hook('updating', (modifications) =>
    'updatedAt' in (modifications as object) ? undefined : { updatedAt: Date.now() },
  )
}

export class BillerDb extends Dexie {
  settings!: Table<SettingRow, string>
  itemGroups!: Table<ItemGroup, number>
  items!: Table<Item, number>
  customers!: Table<Customer, number>
  customerPrices!: Table<CustomerPrice, number>
  orders!: Table<Order, number>
  orderLines!: Table<OrderLine, number>
  payments!: Table<Payment, number>
  expenseCategories!: Table<ExpenseCategory, number>
  expenses!: Table<Expense, number>

  constructor(name = 'my-biller') {
    super(name)

    // KHÔNG BAO GIỜ sửa version(1). Đổi schema về sau phải thêm version(n+1).stores(...).upgrade(...)
    // vì app không có backend để migrate hộ — dữ liệu nằm trên máy người dùng.
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

    stampTimestamps(this.itemGroups)
    stampTimestamps(this.items)
    stampTimestamps(this.customers)
    stampTimestamps(this.customerPrices)
    stampTimestamps(this.orders)
    stampTimestamps(this.expenseCategories)
    stampTimestamps(this.expenses)

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
    this.on('ready', () => {
      const daKhai = new Set(this.tables.map((table) => table.name))
      const laHoac = [...this.backendDB().objectStoreNames].filter((name) => !daKhai.has(name))
      if (laHoac.length === 0) return

      blockDb('stale-app')
      throw new Error(`App cũ hơn dữ liệu trong máy (chưa biết bảng: ${laHoac.join(', ')}).`)
    })
  }
}

export const db = new BillerDb()
