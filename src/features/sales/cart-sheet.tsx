import type { ReactNode } from 'react'
import { Button } from '@/ui/button'
import { Sheet } from '@/ui/sheet'
import { leaveFocusThen } from './leave-focus'

/**
 * Đơn đang lên, mở từ thanh tổng ở đáy màn Bán. Lưới món giữ trọn màn hình, còn các dòng đơn chỉ hiện khi
 * người bán cần xem hay sửa. `children` là danh sách dòng; `notice` là banner của màn Bán (Hoàn lại, cảnh báo
 * giá) — phải hiện lại ở đây vì lớp phủ của sheet che mất banner nằm trên màn phía sau.
 */
export function CartSheet({
  customerName,
  summary,
  notice,
  totals,
  payLabel,
  payDisabled,
  onAdjust,
  onPay,
  onClose,
  children,
}: {
  customerName: string
  summary: string
  notice: ReactNode
  totals: ReactNode
  payLabel: string
  payDisabled: boolean
  onAdjust: () => void
  onPay: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Sheet
      title={`Đơn · ${customerName}`}
      onClose={leaveFocusThen(onClose)}
      footer={
        <>
          {totals}
          <Button size="cta" disabled={payDisabled} onClick={leaveFocusThen(onPay)}>
            {payLabel}
          </Button>
        </>
      }
    >
      <div className="-m-4">
        <p className="px-4 pt-3 text-[13px] text-muted">{summary}</p>
        {notice}
        <div className="pt-2">{children}</div>
        <div className="p-4">
          <Button variant="secondary" onClick={leaveFocusThen(onAdjust)}>
            Giảm giá / phụ thu
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
