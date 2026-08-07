import { eachDayOfInterval, format } from 'date-fns'
import type { OrderStatus } from './order-status'

type ReportOrder = { id?: number; soldAt: number; total: number; status: OrderStatus }
type ReportLine = {
  orderId: number
  itemId: number | null
  name: string
  qty: number
  amount: number
  costPrice: number | null
}
type ReportExpense = { spentAt: number; amount: number }

export type TopItem = {
  key: string
  name: string
  qty: number
  amount: number
  cogs: number
  /** Mọi dòng của món này đều đã có giá nhập. Thiếu một dòng là con số lãi không còn nói được gì. */
  hasFullCost: boolean
}

export type DailyPoint = { day: string; revenue: number; expense: number }

const isCounted = (order: ReportOrder) => order.status !== 'void'

/** Doanh thu = tổng tiền đơn (đã chốt), không phải tiền đã cầm. Đơn huỷ không tính. */
export function aggregateRevenue(orders: readonly ReportOrder[]): number {
  return orders.filter(isCounted).reduce((sum, order) => sum + order.total, 0)
}

/** Đã thu = tổng phiếu thu. Chênh giữa doanh thu và đã thu chính là công nợ. */
export function aggregateCollected(payments: readonly { amount: number }[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0)
}

/** Chỉ cộng dòng có giá vốn; dòng chưa nhập giá vốn bị bỏ qua chứ không coi là 0 lãi. */
export function aggregateCogs(lines: readonly ReportLine[]): number {
  return lines.reduce(
    (sum, line) => (line.costPrice === null ? sum : sum + Math.round(line.costPrice * line.qty)),
    0,
  )
}

export function aggregateExpense(expenses: readonly { amount: number }[]): number {
  return expenses.reduce((sum, expense) => sum + expense.amount, 0)
}

/**
 * Tỷ lệ tiền hàng đã khai giá nhập (0..1). Dưới 1 nghĩa là số lãi đang thiếu phần giá vốn của mấy
 * dòng bỏ trống — phải nói ra, không được để người bán tưởng lãi cao thật.
 *
 * Không bán gì thì trả 1: không có dòng nào thiếu, và tránh chia 0.
 */
export function costCoverage(lines: readonly ReportLine[]): number {
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  if (total === 0) return 1
  const covered = lines.reduce((sum, line) => (line.costPrice === null ? sum : sum + line.amount), 0)
  return covered / total
}

export function topItems(lines: readonly ReportLine[], limit = 5): TopItem[] {
  const byKey = new Map<string, TopItem>()

  for (const line of lines) {
    const key = line.itemId === null ? `name:${line.name}` : `item:${line.itemId}`
    const cogs = line.costPrice === null ? 0 : Math.round(line.costPrice * line.qty)
    const current = byKey.get(key)
    if (current) {
      current.qty += line.qty
      current.amount += line.amount
      current.cogs += cogs
      current.hasFullCost &&= line.costPrice !== null
    } else {
      byKey.set(key, {
        key,
        name: line.name,
        qty: line.qty,
        amount: line.amount,
        cogs,
        hasFullCost: line.costPrice !== null,
      })
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Trả về đủ mọi ngày trong khoảng, ngày không phát sinh điền 0 — biểu đồ cột không được nhảy cóc. */
export function dailySeries(
  orders: readonly ReportOrder[],
  expenses: readonly ReportExpense[],
  from: number,
  to: number,
): DailyPoint[] {
  const revenueByDay = new Map<string, number>()
  for (const order of orders.filter(isCounted)) {
    const day = format(order.soldAt, 'yyyy-MM-dd')
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + order.total)
  }

  const expenseByDay = new Map<string, number>()
  for (const expense of expenses) {
    const day = format(expense.spentAt, 'yyyy-MM-dd')
    expenseByDay.set(day, (expenseByDay.get(day) ?? 0) + expense.amount)
  }

  return eachDayOfInterval({ start: from, end: to }).map((date) => {
    const day = format(date, 'yyyy-MM-dd')
    return { day, revenue: revenueByDay.get(day) ?? 0, expense: expenseByDay.get(day) ?? 0 }
  })
}

export type ReportInput = {
  orders: readonly ReportOrder[]
  /** Dòng hàng của **mọi** đơn trong kỳ, kể cả đơn huỷ — hàm này tự loại. */
  lines: readonly ReportLine[]
  expenses: readonly { amount: number }[]
  payments: readonly { amount: number }[]
}

export type ReportNumbers = {
  revenue: number
  collected: number
  cogs: number
  expense: number
  profit: number
  costCoverage: number
  /** Đã xếp hạng nhưng **chưa cắt** — màn hình tự quyết hiện 5 dòng hay tất cả. */
  topItems: TopItem[]
}

/**
 * Toàn bộ số của một kỳ. Đây là chỗ duy nhất lọc đơn huỷ ra khỏi **cả** dòng hàng — gọi lẻ
 * `aggregateCogs`/`topItems` trên dòng chưa lọc thì giá vốn và bảng bán chạy sẽ tính cả đơn đã huỷ.
 *
 * `profit = revenue − cogs − expense`. Ba thành phần luôn hiện tách nhau trên màn: gộp lại thành một
 * con số thì người bán không thấy được mình có đang khai tiền hàng hai lần hay không.
 */
export function aggregate(input: ReportInput): ReportNumbers {
  const counted = input.orders.filter(isCounted)
  const countedIds = new Set(counted.map((order) => order.id))
  const lines = input.lines.filter((line) => countedIds.has(line.orderId))

  const revenue = counted.reduce((sum, order) => sum + order.total, 0)
  const cogs = aggregateCogs(lines)
  const expense = aggregateExpense(input.expenses)

  return {
    revenue,
    collected: aggregateCollected(input.payments),
    cogs,
    expense,
    profit: revenue - cogs - expense,
    costCoverage: costCoverage(lines),
    topItems: topItems(lines, Number.POSITIVE_INFINITY),
  }
}
