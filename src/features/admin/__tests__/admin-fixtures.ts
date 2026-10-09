import { vi } from 'vitest'
import type {
  AdminDataPage,
  AdminDataRow,
  AdminShopsPage,
  HeartbeatRecord,
  ShopDetail,
  ShopOverview,
  UnpairedPage,
} from '@shared/admin-contract'

export const SECRET = 'test-admin-view-secret-0123456789abcdef'

export const SHOP_A = '3f9a0c21-0000-4000-8000-0000000000a1'
export const SHOP_B = '8b2d7e40-0000-4000-8000-0000000000b2'
export const INSTALL_UNPAIRED = '7c1e4b2a-0000-4000-8000-000000000a90'
export const INSTALL_PAIRED = '9d2f5c3b-0000-4000-8000-000000000b71'

const T0 = Date.UTC(2026, 9, 1, 3)
const T1 = Date.UTC(2026, 9, 8, 3)

const summaryA = { orderCount: 12, customerCount: 4, debtTotal: 150000, revenue: 2350000 }
const summaryB = { orderCount: 3, customerCount: 9, debtTotal: 40000, revenue: 500000 }

export const overviewA: ShopOverview & { via: 'create' } = {
  shopId: SHOP_A,
  createdAt: T0,
  shopName: 'Quán Cơm A',
  latestSeq: 7,
  devices: [
    { id: 'dev-a1', letter: 'A', label: 'Quầy A', createdAt: T0, revokedAt: null, lastSeenAt: T1, pulledSeq: 5, rewoundAt: null },
    { id: 'dev-a2', letter: 'B', label: 'Quầy B', createdAt: T0, revokedAt: T1, lastSeenAt: null, pulledSeq: null, rewoundAt: null },
    { id: 'dev-a3', letter: 'C', label: 'Quầy C', createdAt: T0, revokedAt: null, lastSeenAt: T1, pulledSeq: 2, rewoundAt: T1 },
  ],
  summary: summaryA,
  via: 'create',
}

export const overviewB: ShopOverview & { via: 'backfill' } = {
  shopId: SHOP_B,
  createdAt: T0,
  shopName: 'Quán Bún B',
  latestSeq: 7,
  devices: [{ id: 'dev-b1', letter: 'A', label: 'Quầy Bún', createdAt: T0, revokedAt: null, lastSeenAt: T1, pulledSeq: 7, rewoundAt: null }],
  summary: summaryB,
  via: 'backfill',
}

export function shopsPage(shops: AdminShopsPage['shops'], next: string | null = null): AdminShopsPage {
  return { shops, next }
}

export function shopDetailA(): ShopDetail {
  return {
    ...overviewA,
    debts: [{ customerGid: 'cust-1', name: 'Chị Lan', total: 150000, orderCount: 2, oldestAt: T0 }],
  }
}

export const unpairedRecord: HeartbeatRecord = {
  installId: INSTALL_UNPAIRED,
  shopName: 'Quán Gió',
  appVersion: '2.15.0',
  platform: 'apk',
  orderCount: 0,
  customerCount: 0,
  debtTotal: 0,
  firstSeenAt: T1,
  lastSeenAt: T1,
  pairedShopId: null,
  pairedAt: null,
}

export const pairedRecord: HeartbeatRecord = {
  installId: INSTALL_PAIRED,
  shopName: 'Quán Mới',
  appVersion: '',
  platform: 'browser',
  orderCount: 5,
  customerCount: 2,
  debtTotal: 90000,
  firstSeenAt: T0,
  lastSeenAt: T1,
  pairedShopId: SHOP_A,
  pairedAt: T1,
}

export const unpairedPage: UnpairedPage = { devices: [unpairedRecord, pairedRecord], total: 2, new24h: 1 }

export function orderRow(index: number, updatedSeq: number): AdminDataRow {
  return {
    entityKey: `order-${index}`,
    updatedSeq,
    after: { status: 'paid', total: 10000 * index, createdAt: T0 },
    refs: { customerId: 'cust-1' },
  }
}

export function orderLineRow(orderGid: string, name: string, updatedSeq: number): AdminDataRow {
  return {
    entityKey: `line-${orderGid}-${name}`,
    updatedSeq,
    after: { name, amount: 50000 },
    refs: { orderId: orderGid },
  }
}

export function customerRow(entityKey: string, name: string, updatedSeq: number): AdminDataRow {
  return { entityKey, updatedSeq, after: { name, createdAt: T0 }, refs: {} }
}

export function dataPage(rows: AdminDataRow[], next: number | null = null): AdminDataPage {
  return { rows, next }
}

export const digitsOf = (element: Element | null): string => (element?.textContent ?? '').replace(/\D/g, '')

export function spyStorageWrites() {
  return [
    vi.spyOn(window.localStorage, 'setItem'),
    // sessionStorage của jsdom: spy trên chính đối tượng không bắt được lời gọi mà còn tạo khoá "setItem" trong kho.
    vi.spyOn(Object.getPrototypeOf(window.sessionStorage) as Storage, 'setItem'),
    vi.spyOn(Storage.prototype, 'setItem'),
  ]
}
