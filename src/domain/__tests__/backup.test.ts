import { describe, expect, it } from 'vitest'
import { backupFilename, countRecords, describeCounts, parseBackupFile } from '../backup'
import type { BackupData } from '../schema'

const emptyData: BackupData = {
  settings: [],
  itemGroups: [],
  items: [],
  customers: [],
  orders: [],
  orderLines: [],
  payments: [],
  expenseCategories: [],
  expenses: [],
}

const file = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    app: 'my-biller',
    version: 1,
    appVersion: '1.0.0',
    exportedAt: '2026-08-07T07:00:00.000Z',
    data: emptyData,
    ...overrides,
  })

describe('backupFilename', () => {
  it('mang ngày giờ để hai lần sao lưu trong ngày không đè lên nhau', () => {
    const at = new Date(2026, 7, 7, 14, 5).getTime()
    expect(backupFilename(at)).toBe('my-biller-backup-260807-1405.json')
  })
})

describe('parseBackupFile', () => {
  it('nhận file đúng định dạng', () => {
    expect(parseBackupFile(file()).app).toBe('my-biller')
  })

  it('file không phải JSON', () => {
    expect(() => parseBackupFile('đây là ảnh chụp màn hình')).toThrow(/không phải file sao lưu/)
  })

  it('file của app khác nói rõ là app khác, không nói "hỏng"', () => {
    expect(() => parseBackupFile(file({ app: 'sổ-tay-khác' }))).toThrow(/ứng dụng khác/)
  })

  it('file của bản mới hơn bảo người dùng cập nhật, không bảo file hỏng', () => {
    expect(() => parseBackupFile(file({ version: 2 }))).toThrow(/v2/)
  })

  it('thiếu bảng thì chỉ đúng chỗ hỏng', () => {
    const missingOrders: Partial<BackupData> = { ...emptyData }
    delete missingOrders.orders
    expect(() => parseBackupFile(file({ data: missingOrders }))).toThrow(/data\.orders/)
  })

  it('số tiền lẻ trong file bị chặn — bất biến "tiền là số nguyên" áp cả với đường nhập', () => {
    const data = {
      ...emptyData,
      expenses: [
        { id: 1, categoryId: null, amount: 1000.5, note: '', spentAt: 0, createdAt: 0, updatedAt: 0 },
      ],
    }
    expect(() => parseBackupFile(file({ data }))).toThrow(/hỏng/)
  })
})

describe('countRecords', () => {
  it('đếm những thứ người bán nhận ra, không đếm bảng phụ', () => {
    const counts = countRecords({
      ...emptyData,
      orders: [1, 2, 3].map(() => ({}) as never),
      items: [1, 2].map(() => ({}) as never),
    })
    expect(counts).toEqual({ orders: 3, items: 2, customers: 0, expenses: 0 })
    expect(describeCounts(counts)).toBe('3 đơn · 2 mặt hàng · 0 khách · 0 khoản chi')
  })
})
