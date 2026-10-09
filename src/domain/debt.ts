import { differenceInCalendarDays } from 'date-fns'
import {
  groupDebts,
  owingOf,
  totalDebt,
  type DebtOrder,
} from '@shared/ledger-money'

export {
  groupDebts,
  isCountedPayment,
  owingOf,
  totalDebt,
  type DebtGroup,
} from '@shared/ledger-money'

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
