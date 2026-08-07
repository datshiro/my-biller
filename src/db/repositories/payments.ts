import { db } from '../db'
import { assertMoney, formatVnd } from '@/domain/money'
import { deriveStatus, remainingOf } from '@/domain/order-status'
import { allocateDebtPayment } from '@/domain/payment-allocation'
import { PaymentSchema, type Payment } from '@/domain/schema'

export type PaymentInput = Pick<Payment, 'orderId' | 'amount' | 'method' | 'paidAt' | 'note'>

/**
 * Chỉ file này được ghi bảng `payments`, và luôn cập nhật `orders.paidAmount` trong cùng transaction.
 * Bất biến: với mọi đơn, `paidAmount === Σ payments.amount`.
 */
export async function addOrderPayment(input: PaymentInput): Promise<number> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const order = await db.orders.get(input.orderId)
    if (!order) throw new Error(`Không tìm thấy đơn #${input.orderId}`)
    if (order.status === 'void') throw new Error(`Đơn ${order.code} đã huỷ — không thu thêm được.`)

    const remaining = remainingOf(order.total, order.paidAmount)
    if (input.amount > remaining) {
      throw new Error(
        `Thu ${formatVnd(input.amount)} vượt số còn nợ của đơn ${order.code} (${formatVnd(remaining)}).`,
      )
    }

    const paymentId = await db.payments.add(
      PaymentSchema.parse({ ...input, customerId: order.customerId }),
    )

    const paidAmount = assertMoney(order.paidAmount + input.amount, 'Tiền đã thu')
    await db.orders.update(input.orderId, {
      paidAmount,
      status: deriveStatus(order.total, paidAmount),
    })

    return paymentId
  })
}

export function listPaymentsBetween(from: number, to: number): Promise<Payment[]> {
  return db.payments.where('paidAt').between(from, to, true, true).toArray()
}

/** Mới nhất lên đầu — lịch sử thu nợ đọc từ trên xuống. */
export async function listCustomerPayments(customerId: number): Promise<Payment[]> {
  const payments = await db.payments.where('customerId').equals(customerId).sortBy('paidAt')
  return payments.reverse()
}

export type CollectDebtInput = Pick<Payment, 'customerId' | 'amount' | 'method' | 'paidAt' | 'note'> & {
  customerId: number
}

/**
 * Thu nợ của một khách: phân bổ vào đơn cũ nhất trước, mỗi đơn một dòng `payments` riêng.
 *
 * Toàn bộ phân bổ nằm trong **một** transaction. Thu 250k rải qua 3 đơn mà hỏng ở đơn thứ 3 thì hai
 * đơn đầu cũng phải quay về nguyên trạng — nợ trả một nửa còn khó dò hơn là chưa trả.
 *
 * Thu quá tổng nợ bị **từ chối**, không tự sinh tiền thừa: app không có chỗ để giữ số dư của khách,
 * mà đẻ ra chỗ đó thì lại thành nguồn sự thật thứ hai.
 */
export async function collectDebt(input: CollectDebtInput): Promise<number[]> {
  return db.transaction('rw', db.orders, db.payments, async () => {
    const orders = await db.orders.where('customerId').equals(input.customerId).toArray()

    const open = orders.flatMap((order) =>
      order.id === undefined || order.status === 'void'
        ? []
        : [
            {
              order,
              orderId: order.id,
              remaining: remainingOf(order.total, order.paidAmount),
              soldAt: order.soldAt,
            },
          ],
    )

    const { allocations, leftover } = allocateDebtPayment(open, input.amount)
    if (leftover > 0) {
      const owed = input.amount - leftover
      throw new Error(`Khách chỉ còn nợ ${formatVnd(owed)}, không thu ${formatVnd(input.amount)} được.`)
    }

    // Duyệt theo `open` chứ không theo `allocations` để mỗi đơn luôn đi kèm `total`/`paidAmount` của
    // chính nó — khỏi phải tra ngược rồi xử lý một nhánh "không tìm thấy" vốn không thể xảy ra.
    const share = new Map(allocations.map((allocation) => [allocation.orderId, allocation.amount]))
    const paymentIds: number[] = []

    for (const entry of open) {
      const amount = share.get(entry.orderId)
      if (amount === undefined) continue

      paymentIds.push(
        await db.payments.add(
          PaymentSchema.parse({
            orderId: entry.orderId,
            customerId: input.customerId,
            amount,
            method: input.method,
            paidAt: input.paidAt,
            note: input.note,
          }),
        ),
      )

      const paidAmount = assertMoney(entry.order.paidAmount + amount, 'Tiền đã thu')
      await db.orders.update(entry.orderId, {
        paidAmount,
        status: deriveStatus(entry.order.total, paidAmount),
      })
    }

    return paymentIds
  })
}
