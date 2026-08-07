import { useLiveQuery } from 'dexie-react-hooks'
import { getOrder, getOrderLines, getOrderPayments } from '@/db/repositories/orders'
import { getShop } from '@/db/repositories/settings'
import type { Order, OrderLine, Payment, ShopSettings } from '@/domain/schema'

export type ReceiptData = {
  shop: ShopSettings
  order: Order
  lines: OrderLine[]
  payments: Payment[]
}

/** `undefined` = đang đọc, `null` = không có đơn này. */
export function useReceipt(orderId: number): ReceiptData | null | undefined {
  return useLiveQuery(async () => {
    if (!Number.isInteger(orderId) || orderId <= 0) return null
    const order = await getOrder(orderId)
    if (!order) return null

    const [shop, lines, payments] = await Promise.all([
      getShop(),
      getOrderLines(orderId),
      getOrderPayments(orderId),
    ])
    return { shop, order, lines, payments }
  }, [orderId])
}

/**
 * Chữ ký của những gì ảnh hưởng tới ảnh phiếu. `useLiveQuery` trả object mới mỗi lần DB đổi,
 * nên phải so bằng chuỗi này thay vì so tham chiếu — không thì phiếu bị chụp lại liên tục.
 */
export function receiptSignature(data: ReceiptData | null | undefined): string | null {
  if (!data) return null
  const { order, lines, payments, shop } = data
  return [order.id, order.updatedAt, order.status, lines.length, payments.length, shop.name, shop.address, shop.phone, shop.footerNote].join('|')
}
