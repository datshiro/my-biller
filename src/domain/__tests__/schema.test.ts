import { describe, expect, it } from 'vitest'
import {
  BackupFileSchema,
  ItemSchema,
  OrderLineSchema,
  OrderSchema,
  PaymentSchema,
  ShopSettingsSchema,
} from '../schema'
import { testGid } from '@/test-fixtures'

const emptyBackup = {
  app: 'my-biller',
  version: 1,
  appVersion: '1.0.0',
  exportedAt: '2026-08-07T03:00:00.000Z',
  data: {
    settings: [],
    itemGroups: [],
    items: [],
    customers: [],
    orders: [],
    orderLines: [],
    payments: [],
    expenseCategories: [],
    expenses: [],
  },
}

describe('BackupFileSchema', () => {
  it('nhận đúng 5 trường ở cấp gốc — Phase 9 dựa vào hình dạng này', () => {
    const parsed = BackupFileSchema.parse(emptyBackup)
    expect(Object.keys(parsed).sort()).toEqual(['app', 'appVersion', 'data', 'exportedAt', 'version'])
  })

  it('từ chối file của app khác hoặc version lạ', () => {
    expect(() => BackupFileSchema.parse({ ...emptyBackup, app: 'knote' })).toThrow()
    expect(() => BackupFileSchema.parse({ ...emptyBackup, version: 5 })).toThrow()
  })

  /**
   * `emptyBackup` là đúng hình dạng file v1: chưa có khoá `customerPrices`. Nó phải đi qua được — và
   * đi qua bằng **cửa rẽ theo version**, nên cùng một `data` đó gắn nhãn v2 thì phải bị từ chối. Cho
   * `customerPrices` một `.default([])` sẽ làm cả hai ca cùng qua, và `version` thành chữ trang trí.
   */
  it('v1 thiếu bảng giá thì bù rỗng, v2 thiếu bảng giá thì từ chối', () => {
    expect(BackupFileSchema.parse(emptyBackup).data.customerPrices).toEqual([])
    expect(() => BackupFileSchema.parse({ ...emptyBackup, version: 2 })).toThrow()
  })
})

describe('ràng buộc tiền tệ trong schema', () => {
  const order = {
    gid: testGid(1),
    code: 'PBH-260807-001',
    customerId: null,
    customerName: 'Khách lẻ',
    subtotal: 100_000,
    discount: 0,
    surcharge: 0,
    total: 100_000,
    paidAmount: 0,
    status: 'unpaid',
    soldAt: 1,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  }

  it('chặn số tiền thập phân và số âm', () => {
    expect(() => OrderSchema.parse({ ...order, total: 100_000.5 })).toThrow()
    expect(() => OrderSchema.parse({ ...order, discount: -1 })).toThrow()
  })

  it('phiếu thu phải lớn hơn 0', () => {
    const payment = {
      gid: testGid(2),
      orderId: 1,
      allocatedOrderId: 0,
      customerId: null,
      amount: 0,
      method: 'cash',
      paidAt: 1,
      note: '',
    }
    expect(() => PaymentSchema.parse(payment)).toThrow()
    expect(PaymentSchema.parse({ ...payment, amount: 1 }).amount).toBe(1)
  })

  it('phiếu thu hiện hành phải nói rõ đang phân bổ vào đơn nào hoặc bằng 0', () => {
    const payment = {
      gid: testGid(2),
      orderId: 1,
      customerId: null,
      amount: 1,
      method: 'cash',
      paidAt: 1,
      note: '',
    }

    expect(() => PaymentSchema.parse(payment)).toThrow()
    expect(PaymentSchema.parse({ ...payment, allocatedOrderId: 0 }).allocatedOrderId).toBe(0)
  })

  it('cờ isActive lưu 0/1 vì IndexedDB không index được boolean', () => {
    const item = { gid: testGid(3), name: 'Phở', groupId: null, unit: 'tô', unitPrice: 1_000, costPrice: null, createdAt: 1, updatedAt: 1 }
    expect(() => ItemSchema.parse({ ...item, isActive: true })).toThrow()
    expect(ItemSchema.parse({ ...item, isActive: 1 }).isActive).toBe(1)
  })

  it('đơn vị toàn khoảng trắng thành rỗng, vì guard `unit ? …` ở các màn không phân biệt được', () => {
    const item = { gid: testGid(4), name: 'Phở', groupId: null, unitPrice: 1_000, costPrice: null, isActive: 1, createdAt: 1, updatedAt: 1 }
    // Màn nhập đã tự trim; đường vào còn lại là file sao lưu sửa tay, không qua form nào cả.
    expect(ItemSchema.parse({ ...item, unit: '  ' }).unit).toBe('')
    expect(ItemSchema.parse({ ...item, unit: ' tô ' }).unit).toBe('tô')
  })

  it('bỏ qua trường lạ thay vì ghi rác xuống DB', () => {
    expect(OrderSchema.parse({ ...order, hackedField: 'x' })).not.toHaveProperty('hackedField')
  })
})

describe('OrderLineSchema.note', () => {
  const dòngCũ = {
    gid: testGid(5),
    orderId: 1,
    itemId: null,
    name: 'Phở bò',
    unit: 'tô',
    unitPrice: 40_000,
    costPrice: null,
    qty: 1,
    amount: 40_000,
  }

  it('dòng ghi trước khi có ghi chú đọc ra chuỗi rỗng, không phải undefined', () => {
    // Đây là hàng rào của mọi máy đang chạy bản cũ: file sao lưu cũ và event từ máy chưa cập nhật
    // đều thiếu `note`. Thiếu `.default('')` thì `parse` ném, và cả hai đường nhập đó chết cứng.
    expect(OrderLineSchema.parse(dòngCũ).note).toBe('')
  })

  it('giữ nguyên ghi chú đã có', () => {
    expect(OrderLineSchema.parse({ ...dòngCũ, note: 'ít hành' }).note).toBe('ít hành')
  })
})

describe('ShopSettings: logo và hình chìm trên tem', () => {
  const cũ = { name: 'Q', phone: '', address: '', footerNote: '' }
  const tắt = { enabled: false, position: 'center', strength: 'light' }

  it('bản ghi từ bản cũ chưa có hai trường thì nhận mặc định: không logo, tắt hình chìm', () => {
    const shop = ShopSettingsSchema.parse(cũ)
    expect(shop.logo).toBeNull()
    expect(shop.labelWatermark).toEqual(tắt)
  })

  it('file sao lưu cũ có bản ghi shop thiếu hai trường vẫn khôi phục được', () => {
    const file = BackupFileSchema.parse({
      ...emptyBackup,
      data: { ...emptyBackup.data, settings: [{ key: 'shop', value: cũ }] },
    })
    const row = file.data.settings[0]
    expect(row?.key === 'shop' && row.value.logo).toBeNull()
    expect(row?.key === 'shop' && row.value.labelWatermark).toEqual(tắt)
  })

  it('logo chỉ nhận data URL PNG', () => {
    expect(ShopSettingsSchema.safeParse({ ...cũ, logo: 'data:image/jpeg;base64,AAAA' }).success).toBe(false)
  })

  it('logo dài quá trần bị từ chối: oplog không bao giờ dọn, mỗi lần lưu chép logo hai lần', () => {
    const quáTrần = 'data:image/png;base64,' + 'A'.repeat(40_000)
    expect(ShopSettingsSchema.safeParse({ ...cũ, logo: quáTrần }).success).toBe(false)
  })

  it('giữ nguyên logo và cấu hình hợp lệ', () => {
    const value = {
      ...cũ,
      logo: 'data:image/png;base64,iVBORw0K',
      labelWatermark: { enabled: true, position: 'corner', strength: 'dark' },
    }
    expect(ShopSettingsSchema.parse(value)).toEqual(value)
  })

  it('vị trí lạ bị từ chối', () => {
    const labelWatermark = { enabled: true, position: 'left', strength: 'dark' }
    expect(ShopSettingsSchema.safeParse({ ...cũ, labelWatermark }).success).toBe(false)
  })
})
