import { useLiveQuery } from 'dexie-react-hooks'
import { getOrder, getOrderLines, getOrderPayments, listOrdersByCustomer } from '@/db/repositories/orders'
import { listCustomerPayments, unallocatedByCustomer } from '@/db/repositories/payments'
import { getShop } from '@/db/repositories/settings'
import { receiptDebt, showsDebtBlock } from '@/domain/debt'
import type { Order, OrderLine, Payment, ShopSettings } from '@/domain/schema'

export type ReceiptData = {
  shop: ShopSettings
  order: Order
  lines: OrderLine[]
  payments: Payment[]
  /** Nợ của các đơn KHÁC. `0` khi khách chưa nợ gì, hoặc khi đơn này là của khách lẻ. */
  priorDebt: number
  /** Tổng khách phải trả — bằng đúng con số màn Công nợ đang hiện. */
  totalDue: number
  /**
   * Mốc đọc nợ, cắt xuống phút. `null` khi đơn không gắn khách: khách lẻ không có nợ để đọc, nên
   * không có mốc nào cả. Cố ý dùng `null` chứ không phải `0` — `0` là một mốc HỢP LỆ với `format`
   * và sẽ in "07:00 01/01" lên tờ phiếu đưa tận tay khách, còn `null` thì kiểu bắt phải kiểm.
   */
  debtAsOf: number | null
}

/** `undefined` = đang đọc, `null` = không có đơn này. */
export function useReceipt(orderId: number): ReceiptData | null | undefined {
  return useLiveQuery(async () => {
    if (!Number.isInteger(orderId) || orderId <= 0) return null
    const order = await getOrder(orderId)
    if (!order) return null

    const [shop, lines, payments, customerOrders, customerPayments] = await Promise.all([
      getShop(),
      getOrderLines(orderId),
      getOrderPayments(orderId),
      order.customerId === null ? Promise.resolve([]) : listOrdersByCustomer(order.customerId),
      order.customerId === null ? Promise.resolve([]) : listCustomerPayments(order.customerId),
    ])
    const { prior, totalDue } = receiptDebt(order, customerOrders, unallocatedByCustomer(customerPayments))
    // Cắt xuống phút vì nhãn chỉ hiện HH:mm — và vì mốc này nằm trong `receiptSignature`. Để nguyên
    // mili-giây thì mỗi lần bảng orders/payments đổi ở bất kỳ đâu là phiếu chụp lại ảnh dù nợ y nguyên.
    const debtAsOf = order.customerId === null ? null : Math.floor(Date.now() / 60_000) * 60_000
    return { shop, order, lines, payments, priorDebt: prior, totalDue, debtAsOf }
  }, [orderId])
}

/**
 * Chữ ký của những gì ảnh hưởng tới ảnh phiếu. `useLiveQuery` trả object mới mỗi lần DB đổi,
 * nên phải so bằng chuỗi này thay vì so tham chiếu — không thì phiếu bị chụp lại liên tục.
 */
export function receiptSignature(data: ReceiptData | null | undefined): string | null {
  if (!data) return null
  const { order, lines, payments, shop } = data
  // Luật máy móc kiểm được: thứ gì IN trên phiếu thì phải nằm trong chữ ký. Thiếu ba trường nợ thì
  // thu bớt nợ ở màn Công nợ xong, nút CHIA SẺ vẫn gửi ảnh PNG mang con số cũ.
  //
  // Chiều ngược lại cũng phải giữ: `debtAsOf` là đồng hồ sống, nhét nó vào chữ ký khi mốc đó KHÔNG
  // được in thì mọi thay đổi ở bảng orders/payments qua mốc phút lại chụp lại một tờ phiếu y nguyên.
  //
  // Phải khớp CẢ HAI tầng cổng của bản vẽ, không chỉ tầng ngoài: dòng "Nợ cũ (đến HH:mm)" còn cần
  // `priorDebt > 0`. Khoảng hở `showsDebtBlock && priorDebt === 0` không phải giả thuyết — đó đúng là
  // ca khách có tiền trả trước chưa phân bổ, ca mà `showsDebtBlock` sinh ra để phục vụ.
  const debtAsOf = showsDebtBlock(order, data.totalDue) && data.priorDebt > 0 ? data.debtAsOf : null
  return [order.id, order.updatedAt, order.status, lines.length, payments.length, shop.name, shop.address, shop.phone, shop.footerNote, data.priorDebt, data.totalDue, debtAsOf].join('|')
}
