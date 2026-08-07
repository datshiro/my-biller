import { StatusChip } from '@/ui/chip'
import type { OrderStatus } from '@/domain/order-status'

const LABEL: Record<OrderStatus, { text: string; tone: 'brand' | 'warn' | 'neutral' }> = {
  paid: { text: 'Đã thu', tone: 'brand' },
  partial: { text: 'Trả một phần', tone: 'warn' },
  unpaid: { text: 'Còn nợ', tone: 'warn' },
  void: { text: 'Đã huỷ', tone: 'neutral' },
}

/** Trạng thái tiền luôn hiện bằng CHỮ kèm màu — chỉ dùng màu thì người mù màu không đọc được. */
export function OrderStatusChip({ status }: { status: OrderStatus }) {
  const { text, tone } = LABEL[status]
  return <StatusChip tone={tone}>{text}</StatusChip>
}
