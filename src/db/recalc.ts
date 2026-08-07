import { db } from './db'
import { deriveStatus } from '@/domain/order-status'
import { OrderSchema, type Order } from '@/domain/schema'

function repaired(order: Order, paidAmount: number): Order | null {
  const status = order.status === 'void' ? 'void' : deriveStatus(order.total, paidAmount)
  if (order.paidAmount === paidAmount && order.status === status) return null
  // Đây là đường về của dữ liệu nhập từ file sao lưu — vẫn phải qua schema trước khi ghi đè.
  return OrderSchema.parse({ ...order, paidAmount, status })
}

/** Tính lại `paidAmount`/`status` của một đơn từ bảng `payments` — nguồn sự thật là các phiếu thu. */
export async function recalcOrderPayment(orderId: number): Promise<void> {
  await db.transaction('rw', db.orders, db.payments, async () => {
    const order = await db.orders.get(orderId)
    if (!order) return

    const payments = await db.payments.where('orderId').equals(orderId).toArray()
    const next = repaired(order, payments.reduce((sum, payment) => sum + payment.amount, 0))
    if (next) await db.orders.put(next)
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
      .filter((order): order is Order => order !== null)

    if (fixes.length > 0) await db.orders.bulkPut(fixes)
    return fixes.length
  })
}
