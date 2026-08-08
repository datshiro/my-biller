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

/**
 * Chạy sau khi nhập file sao lưu: sửa mọi đơn lệch và trả về số đơn đã sửa.
 *
 * Đơn huỷ thì phiếu thu của nó phải biến mất theo, không chỉ `paidAmount` về 0. Đưa tổng về 0 mà để
 * dòng `payments` nằm lại là phá bất biến "`paidAmount` bằng tổng phiếu thu của đơn": số tiền đó vẫn
 * hiện trong lịch sử thu tiền của khách và vẫn cộng vào "Đã thu" của kỳ, chỉ mỗi màn chi tiết đơn là
 * không thấy. Và vì `repaired` trả `null` khi đơn đã đúng, lần chạy sau sẽ không bao giờ dọn nữa —
 * nên phải dọn ở đây, độc lập với việc dòng đơn có phải sửa hay không.
 *
 * `addOrderPayment` đã chặn thu tiền trên đơn huỷ, nên cảnh này chỉ đến từ file nhập vào: bản build
 * cũ, hoặc file sửa tay.
 */
export async function recalcAll(): Promise<number> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const paidByOrder = new Map<number, number>()
    await db.payments.each((payment) => {
      paidByOrder.set(payment.orderId, (paidByOrder.get(payment.orderId) ?? 0) + payment.amount)
    })

    let repairs = 0
    for (const order of await db.orders.toArray()) {
      if (order.id === undefined) continue

      const stray = order.status === 'void' && paidByOrder.has(order.id)
      if (stray) await db.payments.where('orderId').equals(order.id).delete()

      const fix = repaired(order, paidByOrder.get(order.id) ?? 0)
      if (fix) await applyFix(fix)
      if (fix || stray) repairs += 1
    }
    return repairs
  })
}
