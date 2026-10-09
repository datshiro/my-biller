import { describe, expect, it } from 'vitest'
import { HEARTBEAT_MAX_BYTES, HeartbeatSchema, RECONCILE_MAX_IDS } from '@shared/admin-contract'

const valid = {
  installId: '3f9a1234-5aaa-4bbb-8ccc-dddddddddc21',
  shopName: 'Quán Chị Hoa',
  appVersion: '2.15.0',
  platform: 'apk',
  orderCount: 12,
  customerCount: 4,
  debtTotal: 150_000,
}

describe('HeartbeatSchema', () => {
  it('nhận body hợp lệ đủ khoá', () => {
    expect(HeartbeatSchema.safeParse(valid).success).toBe(true)
  })

  it('nhận tên quán rỗng', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, shopName: '' }).success).toBe(true)
  })

  it('từ chối khoá lạ, không bỏ qua im lặng', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, orders: [] }).success).toBe(false)
  })

  it('từ chối tên quán dài 81 ký tự', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, shopName: 'a'.repeat(81) }).success).toBe(false)
  })

  it('từ chối phiên bản app dài 21 ký tự', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, appVersion: 'a'.repeat(21) }).success).toBe(false)
  })

  it('từ chối số đơn âm', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, orderCount: -1 }).success).toBe(false)
  })

  it('từ chối nợ có số lẻ', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, debtTotal: 1.5 }).success).toBe(false)
  })

  it('từ chối nền tảng ngoài danh sách', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, platform: 'ios' }).success).toBe(false)
  })

  it('từ chối mã máy không phải UUID', () => {
    expect(HeartbeatSchema.safeParse({ ...valid, installId: 'abc' }).success).toBe(false)
  })
})

describe('hằng số của hợp đồng admin', () => {
  it('giới hạn body heartbeat là 2048 byte', () => {
    expect(HEARTBEAT_MAX_BYTES).toBe(2048)
  })

  it('reconcile nhận tối đa 20 mã mỗi lần', () => {
    expect(RECONCILE_MAX_IDS).toBe(20)
  })
})
