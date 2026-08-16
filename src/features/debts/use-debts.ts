import { useLiveQuery } from 'dexie-react-hooks'
import { listCustomers } from '@/db/repositories/customers'
import { listOpenDebtOrders } from '@/db/repositories/orders'
import {
  listCustomerPayments,
  listUnallocatedPayments,
  unallocatedByCustomer,
} from '@/db/repositories/payments'
import { groupDebts, totalDebt, type DebtGroup } from '@/domain/debt'
import type { Payment } from '@/domain/schema'
import { useDayTick } from '@/ui/use-day-tick'

export type DebtRow = DebtGroup & { name: string }

export type Debts = {
  rows: DebtRow[]
  total: number
  /** Đồng hồ đọc lúc truy vấn — màn hình dùng lại thay vì tự xem giờ khi render. */
  now: number
}

export function useDebts(): Debts | undefined {
  const day = useDayTick()
  return useLiveQuery(async () => {
    const [orders, customers, unallocated] = await Promise.all([
      listOpenDebtOrders(),
      listCustomers(),
      listUnallocatedPayments(),
    ])
    const names = new Map(customers.flatMap((c) => (c.id === undefined ? [] : [[c.id, c.name] as const])))
    const groups = groupDebts(orders, unallocatedByCustomer(unallocated))

    return {
      rows: groups.map((group) => ({ ...group, name: names.get(group.customerId) ?? 'Khách đã xoá' })),
      total: totalDebt(groups),
      now: Date.now(),
    }
  }, [day])
}

/** Kèm `now` để màn hình có mốc ghi phiếu thu mà không phải xem đồng hồ trong lúc render. */
export function useCustomerPayments(
  customerId: number | null,
): { payments: Payment[]; now: number } | undefined {
  return useLiveQuery(
    async () => ({
      payments: customerId === null ? [] : await listCustomerPayments(customerId),
      now: Date.now(),
    }),
    [customerId],
  )
}
