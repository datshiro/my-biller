import { endOfDay, startOfDay } from 'date-fns'
import { db } from '../db'
import { requireDeviceIdentity } from './device-state'
import { syncTransaction } from '../sync/outbox'
import { listUnallocatedPayments, unallocatedByCustomer } from './payments'
import { groupDebts, totalDebt } from '@/domain/debt'
import { newGid } from '@/domain/gid'
import { buildOrderCode, nextSeqOfDay } from '@/domain/order-code'
import { deriveStatus } from '@/domain/order-status'
import { calcLineAmount, calcOrderTotals } from '@/domain/order-total'
import { formatVnd } from '@/domain/money'
import {
  OrderLineSchema,
  OrderSchema,
  PaymentSchema,
  type Order,
  type OrderLine,
  type Payment,
} from '@/domain/schema'

export type OrderLineDraft = Omit<OrderLine, 'id' | 'gid' | 'orderId' | 'amount'>

export type OrderDraft = {
  customerId: number | null
  customerName: string
  lines: OrderLineDraft[]
  discount: number
  surcharge: number
  soldAt: number
  note: string
  /** Tiền khách trả ngay lúc bán. `null` = ghi nợ toàn bộ. */
  payment: Pick<Payment, 'amount' | 'method' | 'note'> | null
}

export function getOrder(id: number): Promise<Order | undefined> {
  return db.orders.get(id)
}

/** Mới nhất lên đầu. Đảo ở JS cho rõ nghĩa thay vì dựa vào thứ tự ngầm của Dexie. */
export async function listOrdersByCustomer(customerId: number): Promise<Order[]> {
  const orders = await db.orders.where('customerId').equals(customerId).sortBy('soldAt')
  return orders.reverse()
}

/** Đơn trong một ngày dương lịch, theo giờ máy. Dùng cho thanh doanh thu hôm nay và báo cáo ngày. */
export function listOrdersOfDay(when: number): Promise<Order[]> {
  return db.orders
    .where('soldAt')
    .between(startOfDay(when).getTime(), endOfDay(when).getTime(), true, true)
    .toArray()
}

/** Đơn trong khoảng [from, to] theo `soldAt`. Màn Đơn hàng nới dần khoảng này thay vì đọc hết bảng. */
export function listOrdersBetween(from: number, to: number): Promise<Order[]> {
  return db.orders.where('soldAt').between(from, to, true, true).toArray()
}

/** Còn đơn nào cũ hơn mốc này không — để biết có nên hiện nút "Xem thêm" hay không. */
export async function hasOrdersBefore(when: number): Promise<boolean> {
  const older = await db.orders.where('soldAt').below(when).first()
  return older !== undefined
}

export function getOrderLines(orderId: number): Promise<OrderLine[]> {
  return db.orderLines.where('orderId').equals(orderId).toArray()
}

export function getOrderPayments(orderId: number): Promise<Payment[]> {
  return db.payments.where('orderId').equals(orderId).sortBy('paidAt')
}

/**
 * Ngưỡng đổi cách truy vấn. `anyOf` bắt Dexie duyệt con trỏ theo từng khoá nên chi phí tăng theo số
 * đơn được hỏi, còn đọc cả bảng là một lượt `getAll` rồi lọc trong bộ nhớ — đắt cố định theo cỡ
 * bảng, không phụ thuộc kỳ báo cáo.
 *
 * Đo trên Chrome desktop, CPU throttle ×6 — mức bóp này là chỗ **thay cho điện thoại rẻ tiền**, và
 * là con số bi quan nhất đang có. `orderLines` 24.000 dòng:
 *
 * | số đơn hỏi | `anyOf` | đọc cả bảng |
 * |---|---|---|
 * | 200 | 9ms | 99ms |
 * | 900 | 34ms | 98ms |
 * | 3.200 | 119ms | 109ms |
 *
 * Chỗ giao nhau **không phải một con số tuyệt đối** mà là một tỷ lệ: đo ở ba cỡ bảng (2.000 / 5.400 /
 * 24.000 dòng) thì nó rơi vào 10–17% số dòng đang có. Ngưỡng cũ 200 nằm dưới xa mọi vạch đó, nên hai
 * kỳ hay xem nhất — "7 ngày qua" và "Tháng" của quán đông khách — đều bị đẩy sang đường chậm gấp ba.
 * 1.500 chọn theo bảng này.
 *
 * Chạy lại trên Chrome trong **máy ảo** Android 16 thì cùng hình dạng đó giữ nguyên trên IndexedDB
 * của Android, chứ không phải một engine khác hẳn — đó là tất cả những gì lượt chạy ấy chứng minh.
 * Nó **không** nói gì về máy chậm: máy ảo chạy trên CPU của máy dev nên nhanh hơn cột throttle ở trên
 * khoảng 3–4 lần (3.200 đơn: 33ms so với 119ms). Số đẹp hơn là vì phần cứng khoẻ hơn, không phải vì
 * ngưỡng an toàn hơn. **Vẫn chưa đo trên điện thoại thật** — muốn xê dịch con số này thì đo ở đó đã.
 *
 * Cách dựng lại hai bảng số trên: chạy `npm run dev`, mở app, rồi trong console gọi thẳng
 * `db.orderLines` (bulkAdd n dòng, `anyOf` so với `toArray().filter`, lấy trung vị 5 lượt), bóp CPU
 * bằng `Emulation.setCPUThrottlingRate` của DevTools.
 *
 * Vẫn giữ một hằng số thay vì đi đếm bảng trước mỗi lần đọc: `count()` mất 1–7ms, tức đắt gấp đôi cả
 * lượt đọc của một kỳ hẹp. 1.500 là chỗ sai ít nhất cho cả bảng nhỏ lẫn bảng lớn — lệch nhiều nhất
 * khoảng 50ms ở dải 2–4 tháng của quán một năm tuổi.
 */
const WIDE_QUERY = 1_500

/** Dòng hàng của nhiều đơn trong một truy vấn. Báo cáo không được đọc `orderLines` từng đơn một. */
export async function listOrderLinesOfOrders(orderIds: readonly number[]): Promise<OrderLine[]> {
  if (orderIds.length === 0) return []
  if (orderIds.length < WIDE_QUERY) {
    return db.orderLines.where('orderId').anyOf([...orderIds]).toArray()
  }

  const wanted = new Set(orderIds)
  const lines = await db.orderLines.toArray()
  return lines.filter((line) => wanted.has(line.orderId))
}

/** Phiếu thu theo `paidAt` — dòng tiền của kỳ, khác doanh thu khi có bán nợ hoặc thu nợ cũ. */
export function listPaymentsBetween(from: number, to: number): Promise<Payment[]> {
  return db.payments
    .where('paidAt')
    .between(from, to, true, true)
    .filter((payment) => !['refunded', 'discarded'].includes(payment.unallocatedStatus ?? 'pending'))
    .toArray()
}

export type DebtSummary = { total: number; customerCount: number }

/**
 * Đơn còn thiếu tiền, **toàn bộ** chứ không giới hạn theo kỳ: khoản nợ từ tháng trước vẫn là tiền
 * chưa đòi được hôm nay. Đây là nguồn duy nhất cho cả màn Công nợ lẫn card ở màn Báo cáo.
 */
export async function listOpenDebtOrders(): Promise<Order[]> {
  // Hai lần `equals` chứ không phải một `anyOf`: mỗi `equals` là một `getAll` trên khoảng khoá, còn
  // `anyOf` duyệt con trỏ qua từng bản ghi — chênh nhau hàng chục lần khi sổ nợ dài.
  const [unpaid, partial] = await Promise.all([
    db.orders.where('status').equals('unpaid').toArray(),
    db.orders.where('status').equals('partial').toArray(),
  ])
  return [...unpaid, ...partial]
}

export async function summarizeDebt(): Promise<DebtSummary> {
  const [orders, unallocated] = await Promise.all([
    listOpenDebtOrders(),
    listUnallocatedPayments(),
  ])
  const groups = groupDebts(orders, unallocatedByCustomer(unallocated))
  return { total: totalDebt(groups), customerCount: groups.length }
}

export type OrderSummary = { lineCount: number; methods: Payment['method'][] }

/**
 * Số món và hình thức trả của nhiều đơn cùng lúc — hai truy vấn `anyOf` cho cả trang,
 * thay vì hai truy vấn cho mỗi dòng.
 */
export async function summarizeOrders(orderIds: readonly number[]): Promise<Map<number, OrderSummary>> {
  const summary = new Map<number, OrderSummary>(orderIds.map((id) => [id, { lineCount: 0, methods: [] }]))
  if (orderIds.length === 0) return summary

  const ids = [...orderIds]
  const [lines, payments] = await Promise.all([
    db.orderLines.where('orderId').anyOf(ids).toArray(),
    db.payments.where('orderId').anyOf(ids).toArray(),
  ])

  for (const line of lines) {
    const row = summary.get(line.orderId)
    if (row) row.lineCount += 1
  }
  for (const payment of payments) {
    const row = summary.get(payment.orderId)
    if (row && !row.methods.includes(payment.method)) row.methods.push(payment.method)
  }

  return summary
}

/**
 * Toàn bộ đơn (order + lines + payment đầu tiên) ghi trong MỘT transaction.
 * Nếu bất kỳ bước nào hỏng, Dexie rollback tất cả — không bao giờ còn đơn mồ côi không có dòng hàng.
 */
export async function createOrder(draft: OrderDraft): Promise<{ id: number; code: string }> {
  if (draft.lines.length === 0) throw new Error('Đơn phải có ít nhất một mặt hàng.')
  const identity = await requireDeviceIdentity()

  return syncTransaction(async () => {
    const lines = draft.lines.map((line) => ({ ...line, amount: calcLineAmount(line) }))
    const totals = calcOrderTotals({ lines, discount: draft.discount, surcharge: draft.surcharge })

    const paidAmount = draft.payment?.amount ?? 0
    if (paidAmount > totals.total) {
      throw new Error(
        `Tiền khách trả (${formatVnd(paidAmount)}) lớn hơn tổng đơn (${formatVnd(totals.total)}).`,
      )
    }

    // Nợ phải có chủ. Ghi nợ cho "Khách lẻ" là tạo khoản không bao giờ đòi được, nên chặn ở đây
    // chứ không chỉ ở giao diện — nhập từ file sao lưu hay gọi thẳng repository đều phải vướng.
    if (paidAmount < totals.total && draft.customerId === null) {
      throw new Error('Đơn còn nợ phải gắn với một khách hàng cụ thể, không ghi nợ cho khách lẻ được.')
    }

    const sameDayCodes = await db.orders
      .where('soldAt')
      .between(startOfDay(draft.soldAt).getTime(), endOfDay(draft.soldAt).getTime(), true, true)
      .toArray()
    const code = buildOrderCode(
      draft.soldAt,
      nextSeqOfDay(
        sameDayCodes.map((order) => order.code),
        draft.soldAt,
        identity.letter,
      ),
      identity.letter,
    )

    const stamp = Date.now()
    const orderId = await db.orders.add(
      OrderSchema.parse({
        gid: newGid(),
        code,
        customerId: draft.customerId,
        customerName: draft.customerName,
        ...totals,
        paidAmount,
        status: deriveStatus(totals.total, paidAmount),
        soldAt: draft.soldAt,
        note: draft.note,
        createdAt: stamp,
        updatedAt: stamp,
      }),
    )

    await db.orderLines.bulkAdd(
      lines.map((line) => OrderLineSchema.parse({ ...line, gid: newGid(), orderId })),
    )

    if (draft.payment) {
      const paymentId = await db.payments.add(
        PaymentSchema.parse({
          gid: newGid(),
          orderId,
          allocatedOrderId: 0,
          customerId: draft.customerId,
          amount: draft.payment.amount,
          method: draft.payment.method,
          paidAt: draft.soldAt,
          note: draft.payment.note,
        }),
      )
      await db.payments.update(paymentId, { allocatedOrderId: orderId })
    }

    return { id: orderId, code }
  })
}

export async function updateOrderNote(id: number, note: string): Promise<void> {
  await syncTransaction(() => db.orders.update(id, { note }))
}

/**
 * Huỷ đơn giữ nguyên sự kiện đã thu tiền, nhưng bỏ phân bổ của chúng khỏi đơn rồi đặt
 * `status='void'`, `paidAmount=0` trong cùng transaction.
 *
 * Đơn huỷ **không** bị xoá khỏi DB: người bán cần thấy nó từng tồn tại, và số phiếu đã đưa cho khách
 * thì không được tái sử dụng. Doanh thu và công nợ đều bỏ qua `status='void'`.
 */
export async function voidOrder(id: number): Promise<void> {
  await syncTransaction(async () => {
    const order = await db.orders.get(id)
    if (!order) throw new Error('Không tìm thấy đơn.')
    if (order.status === 'void') return

    await db.payments.where('allocatedOrderId').equals(id).modify({ allocatedOrderId: 0 })
    await db.orders.update(id, { paidAmount: 0, status: 'void' })
  })
}
