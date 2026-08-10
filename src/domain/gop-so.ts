import { buildOrderCode, nextSeqOfDay } from './order-code'
import type { BackupData } from './schema'

type NumberTable = Exclude<keyof BackupData, 'settings'>

export type MergeDecisions = {
  /** id khách ở sổ B → id khách giữ lại ở sổ A. */
  customers?: Readonly<Record<number, number>>
  /** id mặt hàng ở sổ B → id mặt hàng giữ lại ở sổ A. */
  items?: Readonly<Record<number, number>>
}

export type CodeChange = { orderGid: string; originalCode: string; code: string }

export type MergeReport = {
  codeChanges: CodeChange[]
  idOffsets: Record<NumberTable, number>
  droppedCustomerPrices: number
}

const TABLES: NumberTable[] = [
  'itemGroups',
  'items',
  'customers',
  'customerPrices',
  'orders',
  'orderLines',
  'payments',
  'expenseCategories',
  'expenses',
]

const firstNewId = (rows: readonly { id: number }[]) =>
  rows.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1

const shifted = (id: number, first: number) => id + first - 1
const shiftedNullable = (id: number | null, first: number) =>
  id === null ? null : shifted(id, first)

/**
 * Gộp hai file đã được người vận hành duyệt. Không tự nhận diện khách/món trùng nhau.
 * Sổ A là sổ chuẩn: id và thông tin của nó luôn được giữ.
 */
export function mergeLedgers(
  a: BackupData,
  b: BackupData,
  decisions: MergeDecisions = {},
): { merged: BackupData; report: MergeReport } {
  const idOffsets = Object.fromEntries(
    TABLES.map((table) => [table, firstNewId(a[table] as { id: number }[])]),
  ) as Record<NumberTable, number>

  const mapCustomer = (id: number | null) =>
    id === null
      ? null
      : decisions.customers?.[id] ?? shifted(id, idOffsets.customers)
  const mapItem = (id: number | null) =>
    id === null ? null : decisions.items?.[id] ?? shifted(id, idOffsets.items)

  const usedCodes = new Set([...a.orders, ...b.orders].map((order) => order.code))
  const aCodes = new Set(a.orders.map((order) => order.code))
  const bCodeCounts = new Map<string, number>()
  for (const order of b.orders) bCodeCounts.set(order.code, (bCodeCounts.get(order.code) ?? 0) + 1)
  const codeChanges: CodeChange[] = []

  const bOrders = [...b.orders]
    .sort((left, right) => left.id - right.id)
    .map((order) => {
      let code = order.code
      const collides = aCodes.has(code) || (bCodeCounts.get(code) ?? 0) > 1
      if (collides) {
        code = buildOrderCode(order.soldAt, nextSeqOfDay([...usedCodes], order.soldAt, 'B'), 'B')
        usedCodes.add(code)
        codeChanges.push({ orderGid: order.gid, originalCode: order.code, code })
      }
      return {
        ...order,
        id: shifted(order.id, idOffsets.orders),
        customerId: mapCustomer(order.customerId),
        code,
        originalCode: collides ? order.originalCode || order.code : order.originalCode,
      }
    })

  const existingPrices = new Set(
    a.customerPrices.map((row) => `${row.customerId}:${row.itemId}`),
  )
  let droppedCustomerPrices = 0
  const bPrices = b.customerPrices.flatMap((row) => {
    const mapped = {
      ...row,
      id: shifted(row.id, idOffsets.customerPrices),
      customerId: mapCustomer(row.customerId) as number,
      itemId: mapItem(row.itemId) as number,
    }
    const pair = `${mapped.customerId}:${mapped.itemId}`
    if (existingPrices.has(pair)) {
      droppedCustomerPrices += 1
      return []
    }
    existingPrices.add(pair)
    return [mapped]
  })

  const merged: BackupData = {
    settings: a.settings,
    itemGroups: [
      ...a.itemGroups,
      ...b.itemGroups.map((row) => ({ ...row, id: shifted(row.id, idOffsets.itemGroups) })),
    ],
    items: [
      ...a.items,
      ...b.items.flatMap((row) =>
        decisions.items?.[row.id]
          ? []
          : [
              {
                ...row,
                id: shifted(row.id, idOffsets.items),
                groupId: shiftedNullable(row.groupId, idOffsets.itemGroups),
              },
            ],
      ),
    ],
    customers: [
      ...a.customers,
      ...b.customers.flatMap((row) =>
        decisions.customers?.[row.id]
          ? []
          : [{ ...row, id: shifted(row.id, idOffsets.customers) }],
      ),
    ],
    customerPrices: [...a.customerPrices, ...bPrices],
    orders: [...a.orders, ...bOrders],
    orderLines: [
      ...a.orderLines,
      ...b.orderLines.map((row) => ({
        ...row,
        id: shifted(row.id, idOffsets.orderLines),
        orderId: shifted(row.orderId, idOffsets.orders),
        itemId: mapItem(row.itemId),
      })),
    ],
    payments: [
      ...a.payments,
      ...b.payments.map((row) => ({
        ...row,
        id: shifted(row.id, idOffsets.payments),
        orderId: shifted(row.orderId, idOffsets.orders),
        allocatedOrderId:
          row.allocatedOrderId === 0
            ? 0
            : shifted(row.allocatedOrderId, idOffsets.orders),
        customerId: mapCustomer(row.customerId),
      })),
    ],
    expenseCategories: [
      ...a.expenseCategories,
      ...b.expenseCategories.map((row) => ({
        ...row,
        id: shifted(row.id, idOffsets.expenseCategories),
      })),
    ],
    expenses: [
      ...a.expenses,
      ...b.expenses.map((row) => ({
        ...row,
        id: shifted(row.id, idOffsets.expenses),
        categoryId: shiftedNullable(row.categoryId, idOffsets.expenseCategories),
      })),
    ],
  }

  const codes = merged.orders.map((order) => order.code)
  if (new Set(codes).size !== codes.length) throw new Error('Mã phiếu vẫn còn trùng sau khi gộp sổ.')

  return { merged, report: { codeChanges, idOffsets, droppedCustomerPrices } }
}
