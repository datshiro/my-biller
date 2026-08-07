import { useLiveQuery } from 'dexie-react-hooks'
import {
  getCustomer,
  listCustomers,
  summarizeCustomers,
  type CustomerSummary,
} from '@/db/repositories/customers'
import { listOrdersByCustomer } from '@/db/repositories/orders'
import type { Customer, Order } from '@/domain/schema'

export function useCustomers(): Customer[] | undefined {
  return useLiveQuery(() => listCustomers())
}

export function useCustomerSummaries(): Map<number, CustomerSummary> | undefined {
  return useLiveQuery(() => summarizeCustomers())
}

export function useCustomer(id: number | null): Customer | null | undefined {
  return useLiveQuery(async () => (id === null ? null : ((await getCustomer(id)) ?? null)), [id])
}

export function useCustomerOrders(id: number | null): Order[] | undefined {
  return useLiveQuery(async () => (id === null ? [] : listOrdersByCustomer(id)), [id])
}
