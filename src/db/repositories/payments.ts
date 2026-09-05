import { db } from '../db'
import { isCountedPayment } from '@/domain/debt'
import { newGid } from '@/domain/gid'
import { assertMoney, formatVnd } from '@/domain/money'
import { deriveStatus, remainingOf } from '@/domain/order-status'
import { allocateDebtPayment } from '@/domain/payment-allocation'
import { PaymentSchema, type Payment } from '@/domain/schema'
import { syncTransaction } from '../sync/outbox'

export type PaymentInput = Pick<Payment, 'orderId' | 'amount' | 'method' | 'paidAt' | 'note'>

/**
 * Bất biến: với mọi đơn, `paidAmount === Σ payments.amount`. Ba chỗ ghi bảng `payments` — hàm này,
 * `collectDebt` bên dưới, và `orders.ts` (lúc tạo đơn có trả tiền / lúc huỷ đơn) — đều ghi cùng
 * transaction với `orders.paidAmount`, nên tìm chỗ ghi tiền thì phải ngó cả hai file.
 */
export async function addOrderPayment(input: PaymentInput): Promise<number> {
  return syncTransaction(async () => {
    if (input.amount <= 0) throw new Error('Số tiền thu phải lớn hơn 0.')

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
      PaymentSchema.parse({
        ...input,
        gid: newGid(),
        allocatedOrderId: 0,
        customerId: order.customerId,
      }),
    )
    await db.payments.update(paymentId, { allocatedOrderId: input.orderId })

    const paidAmount = assertMoney(order.paidAmount + input.amount, 'Tiền đã thu')
    await db.orders.update(input.orderId, {
      paidAmount,
      status: deriveStatus(order.total, paidAmount),
    })

    return paymentId
  })
}

/** Mới nhất lên đầu — lịch sử thu nợ đọc từ trên xuống. */
export async function listCustomerPayments(customerId: number): Promise<Payment[]> {
  const payments = await db.payments.where('customerId').equals(customerId).sortBy('paidAt')
  return payments.reverse()
}

export function listUnallocatedPayments(): Promise<Payment[]> {
  return db.payments
    .where('allocatedOrderId')
    .equals(0)
    .filter(isCountedPayment)
    .toArray()
}

export function unallocatedByCustomer(payments: readonly Payment[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (const payment of payments) {
    if (payment.allocatedOrderId !== 0 || payment.customerId === null || !isCountedPayment(payment)) {
      continue
    }
    totals.set(payment.customerId, (totals.get(payment.customerId) ?? 0) + payment.amount)
  }
  return totals
}

export async function resolveUnallocatedPayment(
  paymentId: number,
  action:
    | { kind: 'allocate'; orderId: number }
    | { kind: 'refunded' | 'discarded'; reason: string },
): Promise<void> {
  await syncTransaction(async () => {
    const payment = await db.payments.get(paymentId)
    if (!payment || payment.allocatedOrderId !== 0 || !isCountedPayment(payment)) {
      throw new Error('Khoản thu này đã được xử lý ở nơi khác.')
    }

    if (action.kind !== 'allocate') {
      const reason = action.reason.trim()
      if (!reason) throw new Error('Phải ghi lý do để tiền không rời sổ mà không có dấu vết.')
      await db.payments.update(paymentId, {
        unallocatedStatus: action.kind,
        resolutionNote: reason,
      })
      return
    }

    const order = await db.orders.get(action.orderId)
    if (!order || order.status === 'void' || order.customerId !== payment.customerId) {
      throw new Error('Đơn nhận khoản thu không còn phù hợp.')
    }
    const remaining = remainingOf(order.total, order.paidAmount)
    if (payment.amount > remaining) {
      throw new Error(`Đơn ${order.code} chỉ còn nợ ${formatVnd(remaining)}.`)
    }
    await db.payments.update(paymentId, {
      allocatedOrderId: action.orderId,
      resolutionNote: `Gắn vào ${order.code}.`,
    })
    const paidAmount = assertMoney(order.paidAmount + payment.amount, 'Tiền đã thu')
    await db.orders.update(action.orderId, {
      paidAmount,
      status: deriveStatus(order.total, paidAmount),
    })
  })
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
  return syncTransaction(async () => {
    // Thu 0 đồng mà lặng lẽ trả `[]` thì màn hình báo "đã thu xong" trong khi không có gì được ghi.
    if (input.amount <= 0) throw new Error('Số tiền thu phải lớn hơn 0.')

    const orders = await db.orders.where('customerId').equals(input.customerId).toArray()

    const open = orders.flatMap((order) =>
      order.id === undefined || order.status === 'void'
        ? []
        : [
            {
              order,
              orderId: order.id,
              gid: order.gid,
              remaining: remainingOf(order.total, order.paidAmount),
              soldAt: order.soldAt,
            },
          ],
    )

    const existingCredit =
      unallocatedByCustomer(await listCustomerPayments(input.customerId)).get(input.customerId) ?? 0
    const credited = allocateDebtPayment(open, existingCredit)
    const creditByOrder = new Map(
      credited.allocations.map((allocation) => [allocation.orderId, allocation.amount]),
    )
    const remainingOpen = open.map((entry) => ({
      ...entry,
      remaining: entry.remaining - (creditByOrder.get(entry.orderId) ?? 0),
    }))

    const { allocations, leftover } = allocateDebtPayment(remainingOpen, input.amount)
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

      const paymentId = await db.payments.add(
          PaymentSchema.parse({
            orderId: entry.orderId,
            gid: newGid(),
            allocatedOrderId: 0,
            customerId: input.customerId,
            amount,
            method: input.method,
            paidAt: input.paidAt,
            note: input.note,
          }),
        )
      await db.payments.update(paymentId, { allocatedOrderId: entry.orderId })
      paymentIds.push(paymentId)

      const paidAmount = assertMoney(entry.order.paidAmount + amount, 'Tiền đã thu')
      await db.orders.update(entry.orderId, {
        paidAmount,
        status: deriveStatus(entry.order.total, paidAmount),
      })
    }

    return paymentIds
  })
}
