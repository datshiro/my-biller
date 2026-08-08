import { describe, expect, it } from 'vitest'
import { BackupFileSchema, ItemSchema, OrderSchema, PaymentSchema } from '../schema'

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
    expect(() => BackupFileSchema.parse({ ...emptyBackup, version: 3 })).toThrow()
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
    const payment = { orderId: 1, customerId: null, amount: 0, method: 'cash', paidAt: 1, note: '' }
    expect(() => PaymentSchema.parse(payment)).toThrow()
    expect(PaymentSchema.parse({ ...payment, amount: 1 }).amount).toBe(1)
  })

  it('cờ isActive lưu 0/1 vì IndexedDB không index được boolean', () => {
    const item = { name: 'Phở', groupId: null, unit: 'tô', unitPrice: 1_000, costPrice: null, createdAt: 1, updatedAt: 1 }
    expect(() => ItemSchema.parse({ ...item, isActive: true })).toThrow()
    expect(ItemSchema.parse({ ...item, isActive: 1 }).isActive).toBe(1)
  })

  it('bỏ qua trường lạ thay vì ghi rác xuống DB', () => {
    expect(OrderSchema.parse({ ...order, hackedField: 'x' })).not.toHaveProperty('hackedField')
  })
})
