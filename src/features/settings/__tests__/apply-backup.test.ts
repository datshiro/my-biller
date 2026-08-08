// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBackup, exportBackup } from '../backup'
import { collectBackup } from '@/db/backup'
import { db } from '@/db/db'
import { createCustomer } from '@/db/repositories/customers'
import { createOrder } from '@/db/repositories/orders'
import { addOrderPayment } from '@/db/repositories/payments'
import { getAppState } from '@/db/repositories/settings'

const soldAt = new Date(2026, 7, 7, 10, 0).getTime()
const NOW = new Date(2026, 7, 7, 14, 0).getTime()

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.spyOn(Date, 'now').mockReturnValue(NOW)

  // jsdom không có Blob URL lẫn cơ chế tải file.
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

async function sellOnCredit(total: number, paid: number) {
  const customerId = await createCustomer({ name: 'Chị Hoa', phone: '', address: '', note: '' })
  const { id } = await createOrder({
    customerId,
    customerName: 'Chị Hoa',
    lines: [{ itemId: null, name: 'Phở', unit: 'tô', unitPrice: total, costPrice: null, qty: 1 }],
    discount: 0,
    surcharge: 0,
    soldAt,
    note: '',
    payment: null,
  })
  if (paid > 0) await addOrderPayment({ orderId: id, amount: paid, method: 'cash', paidAt: soldAt, note: '' })
  return id
}

/**
 * Đường ghi đè dữ liệu. `recalcAll()` ở cuối `applyBackup` là cơ chế tự chữa: con số `paidAmount`
 * trong file không được tin, phiếu thu mới là nguồn sự thật. Bỏ lời gọi đó đi thì không màn hình nào
 * kêu — chỉ có tiền trong sổ sai.
 */
describe('applyBackup', () => {
  it('dựng lại paidAmount/status theo phiếu thu, không tin con số trong file', async () => {
    const orderId = await sellOnCredit(110_000, 40_000)
    const file = await collectBackup(NOW)
    const tampered = {
      ...file.data,
      orders: file.data.orders.map((order) => ({ ...order, paidAmount: order.total, status: 'paid' as const })),
    }

    await applyBackup(tampered)

    expect(await db.orders.get(orderId)).toMatchObject({ paidAmount: 40_000, status: 'partial' })
  })

  it('thay sạch dữ liệu cũ chứ không trộn vào', async () => {
    await sellOnCredit(110_000, 110_000)
    const file = await collectBackup(NOW)

    await sellOnCredit(200_000, 200_000)
    expect(await db.orders.count()).toBe(2)

    await applyBackup(file.data)

    expect(await db.orders.count()).toBe(1)
    expect((await db.orders.toArray())[0]?.total).toBe(110_000)
  })
})

describe('exportBackup', () => {
  it('ghi mốc sao lưu để banner nhắc nhở tắt đi', async () => {
    await sellOnCredit(110_000, 110_000)
    expect((await getAppState()).lastBackupAt).toBeNull()

    const filename = await exportBackup(NOW)

    expect(filename).toBe('my-biller-backup-260807-1400.json')
    expect((await getAppState()).lastBackupAt).toBe(NOW)
  })
})
