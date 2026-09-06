import { differenceInCalendarDays } from 'date-fns'
import { remainingOf, type OrderStatus } from './order-status'

type DebtOrder = {
  customerId: number | null
  total: number
  paidAmount: number
  soldAt: number
  status: OrderStatus
}

export type DebtGroup = {
  customerId: number
  total: number
  orderCount: number
  /** Đơn nợ cũ nhất của khách — quyết định thứ tự danh sách và số ngày nợ. */
  oldestAt: number
}

/** Số tiền một đơn còn thiếu. Đơn huỷ không còn nợ ai. */
export function owingOf(order: DebtOrder): number {
  return order.status === 'void' ? 0 : remainingOf(order.total, order.paidAmount)
}

/**
 * Phiếu có vẽ khối "Nợ cũ / TỔNG PHẢI TRẢ" hay không.
 *
 * Một chỗ duy nhất cho ba nơi hỏi cùng câu này — bản vẽ, bản chữ, và chữ ký ảnh. Ba bản chép tay
 * thì bản chữ và bản vẽ trôi khỏi nhau là khách cầm hai con số, còn chữ ký trôi là phiếu chụp lại
 * ảnh cũ hoặc chụp thừa.
 *
 * Cổng là `totalDue !== owingOf(order)` chứ không phải `priorDebt > 0`: khách có tiền trả trước chưa
 * phân bổ thì `priorDebt` bằng 0 mà phiếu VẪN đang đòi thừa. Đơn huỷ không vẽ — nợ của khách vẫn
 * thật, nhưng một hoá đơn đã huỷ không phải tờ giấy đòi tiền.
 */
export function showsDebtBlock(order: DebtOrder, totalDue: number): boolean {
  return order.customerId !== null && order.status !== 'void' && totalDue !== owingOf(order)
}

/**
 * Phiếu thu còn được tính vào tiền hay không.
 *
 * `refunded` là tiền đã trả lại khách, `discarded` là khoản ghi nhận sai đã có ghi vết. Cả hai vẫn
 * nằm trong lịch sử (phiếu thu không xoá được) nhưng không còn là tiền của quán. Một chỗ duy nhất
 * cho năm nơi hỏi cùng câu này — và hai trong năm không phải màn đọc: hàm này nằm trên đường in
 * phiếu (`use-receipt.ts`) và trong cổng ghi của thu nợ (`payments.ts`, trong `syncTransaction`).
 * Sửa nó là sửa cả tiền in ra giấy lẫn tiền ghi xuống sổ, không chỉ một con số trên màn hình.
 */
export function isCountedPayment(payment: {
  unallocatedStatus?: 'pending' | 'refunded' | 'discarded'
}): boolean {
  return (payment.unallocatedStatus ?? 'pending') === 'pending'
}

/**
 * Đơn này không góp đồng nào vào nợ, nên "Nợ cũ" và "TỔNG PHẢI TRẢ" sẽ ra ĐÚNG một con số. Hai dòng
 * trùng nhau trên tờ giấy đưa tận tay khách đọc như lỗi in, nên gộp thành một dòng mang nhãn tự nói
 * ra đây là nợ của đơn TRƯỚC — bỏ trơn dòng "Nợ cũ" thì "TỔNG PHẢI TRẢ" đứng ngay dưới "Đã trả" lại
 * bị đọc thành tổng của đơn hôm nay.
 *
 * Bắt buộc `prior > 0`: khách có tiền trả trước chưa phân bổ làm cả hai vế bằng 0, gộp lúc đó là in
 * một dòng nợ cũ cho người không nợ đồng nào.
 */
export function showsPriorDebtOnly(prior: number, totalDue: number): boolean {
  return prior > 0 && prior === totalDue
}

/**
 * Gộp nợ theo khách, nợ lâu nhất lên đầu.
 *
 * Đơn không gắn khách bị **loại hẳn**: nợ là tiền của một người cụ thể, đơn khách lẻ mà chưa trả đủ
 * là lỗi dữ liệu chứ không phải công nợ. Bán nợ đã bắt buộc chọn khách từ màn bán hàng. Nhờ loại ở
 * đây mà tổng nợ trên trang khách, màn Công nợ và card Báo cáo luôn bằng nhau — cả ba đọc hàm này.
 */
export function groupDebts(
  orders: readonly DebtOrder[],
  unallocatedByCustomer: ReadonlyMap<number, number> = new Map(),
): DebtGroup[] {
  const byCustomer = new Map<number, DebtGroup>()

  for (const order of orders) {
    const owing = owingOf(order)
    if (order.customerId === null || owing <= 0) continue

    const current = byCustomer.get(order.customerId)
    if (current) {
      current.total += owing
      current.orderCount += 1
      current.oldestAt = Math.min(current.oldestAt, order.soldAt)
    } else {
      byCustomer.set(order.customerId, {
        customerId: order.customerId,
        total: owing,
        orderCount: 1,
        oldestAt: order.soldAt,
      })
    }
  }

  for (const [customerId, credit] of unallocatedByCustomer) {
    const group = byCustomer.get(customerId)
    if (!group) continue
    group.total = Math.max(0, group.total - credit)
    if (group.total === 0) byCustomer.delete(customerId)
  }

  return [...byCustomer.values()].sort((a, b) => a.oldestAt - b.oldestAt)
}

export function totalDebt(groups: readonly DebtGroup[]): number {
  return groups.reduce((sum, group) => sum + group.total, 0)
}

/**
 * Nợ luỹ kế in trên phiếu. Đi qua chính `groupDebts` mà màn Công nợ, trang khách và card Báo cáo
 * dùng — bốn chỗ hiện nợ, một chỗ tính.
 *
 * `customerOrders` là TOÀN BỘ đơn của khách, **kể cả đơn đang in**: `totalDue` là con số người bán
 * đòi, nên nó phải bằng đúng số ở màn Công nợ. `prior` suy ra bằng TRỪ chứ không bằng cách loại đơn
 * đang in ra khỏi tập — loại ra thì khi khách có tiền trả trước chưa phân bổ nhiều hơn nợ cũ, phiếu
 * và màn Công nợ nói hai số khác nhau (`groupDebts` kẹp ở 0 rồi xoá hẳn nhóm).
 *
 * Trừ bằng `owingOf` chứ không `remainingOf`: đơn `void` không còn nợ ai, nên nó phải bằng 0 ở
 * **cả hai** vế.
 */
export function receiptDebt(
  order: DebtOrder,
  customerOrders: readonly DebtOrder[],
  unallocated: ReadonlyMap<number, number> = new Map(),
): { prior: number; totalDue: number } {
  const totalDue = totalDebt(groupDebts(customerOrders, unallocated))
  return { prior: Math.max(0, totalDue - owingOf(order)), totalDue }
}

/** Tính theo ngày lịch: bán 23:00 hôm qua, sáng nay đã là "1 ngày" đúng như người bán đếm. */
export function daysOwed(oldestAt: number, now: number): number {
  return differenceInCalendarDays(now, oldestAt)
}
