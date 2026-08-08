import { db } from './db'
import { deriveStatus } from '@/domain/order-status'
import { OrderSchema, type Order } from '@/domain/schema'

type Fix = { id: number; changes: Pick<Order, 'paidAmount' | 'status'>; updatedAt: number }

/**
 * Đơn huỷ luôn về `paidAmount = 0`: `voidOrder` cam kết vậy, và file sao lưu có đơn `void` còn kèm
 * phiếu thu mà giữ nguyên tổng thì màn chi tiết hiện một đơn "Đã huỷ" vẫn ghi "Đã thu 40.000 đ".
 */
function repaired(order: Order, paidAmount: number): Fix | null {
  if (order.id === undefined) return null

  const status = order.status === 'void' ? 'void' : deriveStatus(order.total, paidAmount)
  const paid = status === 'void' ? 0 : paidAmount
  if (order.paidAmount === paid && order.status === status) return null

  // Đây là đường về của dữ liệu nhập từ file sao lưu — vẫn phải qua schema trước khi ghi đè.
  const next = OrderSchema.parse({ ...order, paidAmount: paid, status })
  return { id: order.id, changes: { paidAmount: next.paidAmount, status: next.status }, updatedAt: next.updatedAt }
}

/**
 * Dựng lại số từ phiếu thu **không phải** là người bán vừa sửa đơn, nên mốc `updatedAt` gốc phải ở
 * nguyên chỗ cũ — đúng cam kết "nhập file sao lưu không đóng dấu ngày nhập lên dữ liệu cũ" ở `db.ts`.
 *
 * Phải ghi hai lần: hook `updating` chỉ nhường khi thay đổi có mang `updatedAt`, mà Dexie lược khỏi
 * diff mọi trường không đổi giá trị — nên đưa mốc cũ vào ngay lần ghi đầu là vô ích, nó bị lược rồi
 * bị đóng dấu. Lần ghi thứ hai mang mốc **khác** với dấu vừa đóng nên đi lọt.
 */
async function applyFix(fix: Fix): Promise<void> {
  await db.orders.update(fix.id, fix.changes)
  await db.orders.update(fix.id, { updatedAt: fix.updatedAt })
}

/** Tính lại `paidAmount`/`status` của một đơn từ bảng `payments` — nguồn sự thật là các phiếu thu. */
export async function recalcOrderPayment(orderId: number): Promise<void> {
  await db.transaction('rw', db.orders, db.payments, async () => {
    const order = await db.orders.get(orderId)
    if (!order) return

    const payments = await db.payments.where('orderId').equals(orderId).toArray()
    const fix = repaired(order, payments.reduce((sum, payment) => sum + payment.amount, 0))
    if (fix) await applyFix(fix)
  })
}

/** Chạy sau khi nhập file sao lưu: sửa mọi đơn lệch và trả về số đơn đã sửa. */
export async function recalcAll(): Promise<number> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const paidByOrder = new Map<number, number>()
    await db.payments.each((payment) => {
      paidByOrder.set(payment.orderId, (paidByOrder.get(payment.orderId) ?? 0) + payment.amount)
    })

    const orders = await db.orders.toArray()
    const fixes = orders
      .map((order) => repaired(order, paidByOrder.get(order.id ?? -1) ?? 0))
      .filter((fix): fix is Fix => fix !== null)

    for (const fix of fixes) await applyFix(fix)
    return fixes.length
  })
}
