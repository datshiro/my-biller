import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillerDb } from '../db'
import {
  blockDb,
  getDbBlock,
  isDbUnavailableError,
  resetDbBlock,
  subscribeDbBlock,
} from '../db-block'

afterEach(() => resetDbBlock())

describe('trạng thái chặn', () => {
  it('báo cho người nghe khi bị chặn, và không báo lại cùng một lý do', () => {
    const seen = vi.fn()
    subscribeDbBlock(seen)

    blockDb('stale-app')
    blockDb('stale-app')

    expect(getDbBlock()).toBe('stale-app')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('bỏ đăng ký thì thôi nhận báo', () => {
    const seen = vi.fn()
    subscribeDbBlock(seen)()

    blockDb('other-tab')

    expect(seen).not.toHaveBeenCalled()
  })
})

describe('lỗi nào là lỗi kho dữ liệu không mở được', () => {
  it.each(['VersionError', 'DatabaseClosedError', 'UpgradeError', 'MissingAPIError'])(
    '%s → đúng',
    (name) => {
      const error = new Error('hỏng')
      error.name = name
      expect(isDbUnavailableError(error)).toBe(true)
    },
  )

  it('lỗi thường của app thì không — nút sao lưu vẫn phải hiện', () => {
    expect(isDbUnavailableError(new TypeError('undefined is not a function'))).toBe(false)
    expect(isDbUnavailableError('không phải Error')).toBe(false)
  })
})

/**
 * "Bản build sau" = đúng schema hiện tại cộng thêm một version. Kế thừa `BillerDb` thay vì tự khai lại
 * các bảng: Dexie **xoá** mọi object store không có trong schema được khai, nên một fixture khai thiếu
 * bảng sẽ âm thầm phá dữ liệu và biến ca test thành vô nghĩa. Kế thừa cũng để hai ca dưới không mục
 * mỗi lần app lên version mới.
 */
class BillerDbBanSau extends BillerDb {
  constructor(name: string) {
    super(name)
    this.version(this.verno + 1).stores({ tuongLai: '++id' })
  }
}

describe('bản JS cũ gặp dữ liệu mới hơn', () => {
  it('tab đang mở nhận versionchange → đóng kết nối và chặn màn', async () => {
    const local = new BillerDb('block-versionchange')
    await local.open()

    // Đúng cái xảy ra khi người bán bấm cập nhật ở một tab khác.
    const bumped = new BillerDbBanSau('block-versionchange')
    await bumped.open()

    await vi.waitFor(() => expect(getDbBlock()).toBe('stale-app'))
    expect(local.isOpen()).toBe(false)

    bumped.close()
  })

  /**
   * Bản cũ **mở được** kho mới — Dexie thử `open(name, verno*10)`, ăn `VersionError`, rồi tự mở lại
   * không nêu version. Nó không sập; nó chạy tiếp mà mù một bảng. Đó mới là chỗ chết người, vì
   * `collectBackup` và `replaceAllData` đều duyệt `db.tables`: file sao lưu thiếu hẳn bảng mới nhưng
   * vẫn được đóng dấu "đã sao lưu", và lần nhập sau đó để bảng mới sống sót rồi bám sang bản ghi khác
   * cùng số id. Ca dưới chứng minh cơ chế đó bằng một Dexie khai đúng schema cũ.
   *
   * Vì vậy `BillerDb` phải **chặn ngay ở `ready`**. Đừng đổi ca này thành "mở được thì thôi": lần đo
   * trên Chrome thật cho thấy giá sỉ của một khách nhảy sang khách khác, món khác, không một lỗi nào.
   */
  it('gặp bảng lạ trong kho thì chặn ngay, không đọc không ghi', async () => {
    const moi = new BillerDbBanSau('block-stale-guard')
    await moi.open()
    moi.close()

    const cu = new BillerDb('block-stale-guard')
    await expect(cu.open()).rejects.toThrow(/cũ hơn dữ liệu trong máy/)
    expect(getDbBlock()).toBe('stale-app')

    cu.close()
  })

  /**
   * Đường đi thật của mọi máy đang có app: kho ở v1 (9 bảng), bản mới khai v2 (10 bảng). Cửa chặn mà
   * bắt nhầm ca này là app chết ngay lần cập nhật đầu tiên, trên đúng những máy có dữ liệu thật.
   */
  it('kho v1 cũ gặp bản mới → nâng cấp bình thường, không chặn', async () => {
    const cu = new Dexie('block-upgrade-path')
    cu.version(1).stores({
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
    await cu.open()
    await cu.table('items').add({ name: 'phở' })
    cu.close()

    const moi = new BillerDb('block-upgrade-path')
    await expect(moi.open()).resolves.toBeDefined()
    expect(getDbBlock()).toBeNull()
    await expect(moi.items.count()).resolves.toBe(1)
    await expect(moi.customerPrices.count()).resolves.toBe(0)

    moi.close()
  })

  it('kho đúng bằng schema mình khai thì mở bình thường — cửa chặn không được bắt nhầm', async () => {
    const local = new BillerDb('block-no-false-positive')
    await expect(local.open()).resolves.toBeDefined()
    await expect(local.items.add({ name: 'phở' } as never)).resolves.toBeGreaterThan(0)
    expect(getDbBlock()).toBeNull()

    local.close()
  })

  /**
   * Cơ chế mất tiền, dựng lại bằng một Dexie khai đúng schema **trước khi có bảng giá**. Không có
   * `BillerDb` ở đây: cửa chặn ở trên tồn tại chính vì hành vi dưới đây là hành vi mặc định.
   */
  it('không có cửa chặn thì dòng giá bám sang khách khác — đây là thứ đang được ngăn', async () => {
    const V1 = { items: '++id, name', customers: '++id, name' }

    const moi = new Dexie('block-money')
    moi.version(1).stores(V1)
    moi.version(2).stores({ customerPrices: '++id, &[customerId+itemId]' })
    await moi.open()
    await moi.table('customers').add({ id: 1, name: 'Chị Hoa' })
    await moi.table('items').add({ id: 1, name: 'Phở' })
    await moi.table('customerPrices').add({ id: 1, customerId: 1, itemId: 1, unitPrice: 45_000 })
    moi.close()

    const cu = new Dexie('block-money')
    cu.version(1).stores(V1)
    await cu.open()
    expect(cu.tables.some((table) => table.name === 'customerPrices')).toBe(false)

    // Đúng cái `replaceAllData` làm: xoá theo `db.tables` rồi nạp lại file — bảng giá không bị đụng.
    await cu.transaction('rw', cu.tables, async () => {
      await Promise.all(cu.tables.map((table) => table.clear()))
      await cu.table('customers').bulkPut([{ id: 1, name: 'Anh Tuấn KHÁC HẲN' }])
      await cu.table('items').bulkPut([{ id: 1, name: 'Bún KHÁC HẲN' }])
    })
    cu.close()

    const kiem = new Dexie('block-money')
    kiem.version(1).stores(V1)
    kiem.version(2).stores({ customerPrices: '++id, &[customerId+itemId]' })
    await kiem.open()
    expect(await kiem.table('customerPrices').toArray()).toEqual([
      { id: 1, customerId: 1, itemId: 1, unitPrice: 45_000 },
    ])
    expect((await kiem.table('customers').get(1))?.name).toBe('Anh Tuấn KHÁC HẲN')
    kiem.close()
  })
})
