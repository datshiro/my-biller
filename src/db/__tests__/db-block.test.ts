import 'fake-indexeddb/auto'
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
   * Ca này khoá một hành vi **trái với giả định ban đầu của plan**. Plan viết rằng bản JS cũ mở lại một
   * DB đã lên version cao hơn sẽ ăn `VersionError` rồi màn trắng. Đo ra thì không: Dexie 4 mở kho mà
   * không nêu version, nên nó mở được, đọc được và ghi được những bảng nó biết. (`fake-indexeddb` có
   * thi hành `VersionError` khi nêu version thấp hơn — đã kiểm riêng — nên kết quả này là do Dexie,
   * không phải do thư viện giả dễ dãi.)
   *
   * Hệ quả: phát hành `version(2)` **không** làm hỏng bản cũ ở lần mở lại. Đừng khôi phục lại
   * `blockedBy` hay cửa chặn phát hành dựa trên giả định cũ mà không đo lại.
   */
  it('bản cũ mở lại DB đã lên version cao hơn vẫn đọc ghi được — không VersionError, không màn trắng', async () => {
    const moi = new BillerDbBanSau('block-reopen')
    await moi.open()
    await moi.items.add({ name: 'phở' } as never)
    moi.close()

    const cu = new BillerDb('block-reopen')
    await expect(cu.open()).resolves.toBeDefined()
    await expect(cu.items.count()).resolves.toBe(1)
    await expect(cu.items.add({ name: 'bún' } as never)).resolves.toBeGreaterThan(0)
    expect(getDbBlock()).toBeNull()

    cu.close()
  })
})
