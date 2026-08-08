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
  // Spy đặt trên prototype nên số lần gọi dồn qua các ca nếu không dọn.
  vi.restoreAllMocks()
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

/**
 * `collectBackup` cố ý khoan dung với bản ghi lạ còn `parseBackupFile` thì nghiêm ngặt, nên tồn tại
 * đúng một loại file vừa xuất được vừa không nhập lại được. Hàm này phải **nói ra** loại đó chứ
 * không được tự chặn: nó cũng là bản sao an toàn đứng trước ghi đè và xoá sạch, chặn ở đây thì người
 * bán không nhập được file mới mà cũng không xoá được để bắt đầu lại. Việc dựng thêm cửa xác nhận là
 * của giao diện — xem `backup-flow.test.tsx`.
 */
describe('exportBackup', () => {
  /** Ghi thẳng vào bảng, không qua schema: giả bản build cũ hoặc người dùng sửa tay qua DevTools. */
  const addOddItem = () =>
    db.items.add({
      name: 'Hàng lạ',
      groupId: null,
      unit: '',
      unitPrice: 25_500.5,
      costPrice: null,
      isActive: 1,
      note: '',
      createdAt: soldAt,
      updatedAt: soldAt,
    })

  it('ghi mốc sao lưu để banner nhắc nhở tắt đi', async () => {
    await sellOnCredit(110_000, 110_000)
    expect((await getAppState()).lastBackupAt).toBeNull()

    const outcome = await exportBackup(NOW)

    expect(outcome).toEqual({
      filename: 'my-biller-backup-260807-1400.json',
      importable: true,
      problem: null,
    })
    expect((await getAppState()).lastBackupAt).toBe(NOW)
  })

  it('vẫn ra file với bản ghi lạ — không khoá đường xuất dữ liệu', async () => {
    await sellOnCredit(110_000, 110_000)
    await addOddItem()

    const outcome = await exportBackup(NOW)

    expect(outcome.filename).toBe('my-biller-backup-260807-1400.json')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('nhưng file lạ đó không được tính là đã sao lưu, và nêu đúng chỗ hỏng', async () => {
    await sellOnCredit(110_000, 110_000)
    await addOddItem()

    const outcome = await exportBackup(NOW)

    expect(outcome.importable).toBe(false)
    expect(outcome.problem).toMatch(/data\.items\.\d+\.unitPrice/)
    // Mốc sao lưu tắt banner nhắc. Đóng dấu nó ở đây là bảo người bán "xong rồi" cho một file mà
    // `parseBackupFile` sẽ từ chối — họ chỉ biết vào đúng lúc cần phục hồi.
    expect((await getAppState()).lastBackupAt).toBeNull()
  })
})
