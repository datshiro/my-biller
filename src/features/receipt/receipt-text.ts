import { format } from 'date-fns'
import { formatAmount, formatQty, formatVnd } from '@/domain/money'
import { owingOf, showsDebtBlock, showsPriorDebtOnly } from '@/domain/debt'
import type { Order, OrderLine, Payment, ShopSettings } from '@/domain/schema'

const METHOD: Record<Payment['method'], string> = {
  cash: 'tiền mặt',
  transfer: 'chuyển khoản',
}

/**
 * Bản chữ thuần của phiếu, để dán thẳng vào Zalo khi máy không chia sẻ được file ảnh.
 * Cố tình KHÔNG kẻ bảng bằng khoảng trắng: Zalo hiện bằng font tỉ lệ nên cột sẽ lệch hết.
 */
export function receiptToText({
  shop,
  order,
  lines,
  payments,
  priorDebt,
  totalDue,
  debtAsOf,
}: {
  shop: ShopSettings
  order: Order
  lines: readonly OrderLine[]
  payments: readonly Payment[]
  priorDebt: number
  totalDue: number
  debtAsOf: number | null
}): string {
  const blocks: string[] = []

  const head = [shop.name, shop.address, shop.phone].filter(Boolean)
  if (head.length > 0) blocks.push(head.join('\n'))

  blocks.push(
    ['PHIẾU BÁN HÀNG', `Số: ${order.code}`, format(order.soldAt, 'dd/MM/yyyy HH:mm'), `Khách: ${order.customerName}`].join('\n'),
  )

  blocks.push(
    lines
      .map(
        (line) =>
          `${line.name}${line.note ? ` (${line.note})` : ''} — ${formatQty(line.qty)} × ${formatAmount(line.unitPrice)} = ${formatAmount(line.amount)}`,
      )
      .join('\n'),
  )

  const money: string[] = []
  if (order.discount > 0 || order.surcharge > 0) {
    money.push(`Hàng: ${formatVnd(order.subtotal)}`)
    if (order.discount > 0) money.push(`Giảm giá: ${formatVnd(order.discount)}`)
    if (order.surcharge > 0) money.push(`Phụ thu: ${formatVnd(order.surcharge)}`)
  }
  money.push(`TỔNG CỘNG: ${formatVnd(order.total)}`)
  for (const payment of payments) {
    money.push(`Đã trả (${METHOD[payment.method]}): ${formatVnd(payment.amount)}`)
  }
  // Xem chú thích cùng chỗ ở `receipt-view.tsx` — hai bản phải dùng chung một định nghĩa "còn nợ".
  const remaining = owingOf(order)
  if (remaining > 0) money.push(`CÒN NỢ: ${formatVnd(remaining)}`)
  if (showsDebtBlock(order, totalDue)) {
    if (showsPriorDebtOnly(priorDebt, totalDue) && debtAsOf !== null) {
      money.push(`NỢ CŨ CÒN LẠI (đến ${format(debtAsOf, 'HH:mm dd/MM')}): ${formatVnd(totalDue)}`)
    } else {
      if (priorDebt > 0 && debtAsOf !== null) {
        money.push(`NỢ CŨ (đến ${format(debtAsOf, 'HH:mm dd/MM')}): ${formatVnd(priorDebt)}`)
      }
      money.push(`TỔNG PHẢI TRẢ: ${formatVnd(totalDue)}`)
    }
  }
  blocks.push(money.join('\n'))

  if (order.note) blocks.push(`Ghi chú: ${order.note}`)
  if (shop.footerNote) blocks.push(shop.footerNote)

  return blocks.join('\n\n')
}
