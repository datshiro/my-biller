import { useEffect, useState } from 'react'
import type { AdminDataRow, ShopDetail } from '@shared/admin-contract'
import { formatVnd } from '@/domain/money'
import { shortId } from '@/domain/short-id'
import { Button } from '@/ui/button'
import { MoneyText } from '@/ui/money-text'
import { mergeRows, type AdminClient } from './admin-client'
import { LAG_NOTE, errorText, formatAt, numberField, textField } from './admin-format'
import { ShopBlock } from './admin-shop-block'

type Tab = 'orders' | 'customers' | 'debts'

type Paged = { rows: AdminDataRow[]; next: number | null; loaded: boolean }

const EMPTY: Paged = { rows: [], next: null, loaded: false }

const TABS: { key: Tab; label: string }[] = [
  { key: 'orders', label: 'Đơn' },
  { key: 'customers', label: 'Khách' },
  { key: 'debts', label: 'Công nợ' },
]

const ORDER_STATUS: Record<string, string> = {
  paid: 'đã trả',
  partial: 'trả một phần',
  unpaid: 'chưa trả',
  void: 'đã huỷ',
}

/** Dòng đơn của cả trang đơn trong một lần gọi; trang dòng đơn đầy thì đọc tiếp theo `next`. */
async function loadLinesFor(client: AdminClient, shopId: string, orders: AdminDataRow[]): Promise<AdminDataRow[]> {
  const gids = orders.map((row) => row.entityKey)
  if (gids.length === 0) return []
  let lines: AdminDataRow[] = []
  let after: number | null = 0
  while (after !== null) {
    const page = await client.loadOrderLines(shopId, gids, after)
    lines = mergeRows(lines, page.rows)
    after = page.next
  }
  return lines
}

function formatAmountOf(after: unknown): string {
  const amount = numberField(after, 'amount')
  return amount === null ? '' : formatVnd(amount)
}

function orderIdOf(line: AdminDataRow): string | null {
  return textField(line.refs, 'orderId')
}

function OrderItem({ order, lines }: { order: AdminDataRow; lines: AdminDataRow[] }) {
  const code = textField(order.after, 'code')
  const customer = textField(order.after, 'customerName')
  const status = textField(order.after, 'status')
  const total = numberField(order.after, 'total')
  const paid = numberField(order.after, 'paidAmount')
  const soldAt = numberField(order.after, 'soldAt') ?? numberField(order.after, 'createdAt')
  return (
    <li data-entity-key={order.entityKey} className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{code ?? shortId(order.entityKey)}</span>
        {total !== null ? <MoneyText value={total} /> : null}
      </div>
      <p className="text-[13px] text-muted">
        {[customer || null, status ? (ORDER_STATUS[status] ?? status) : null, paid !== null ? `đã thu ${formatVnd(paid)}` : null, formatAt(soldAt)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <ul className="mt-1 pl-3 text-[13px]">
        {lines.map((line) => (
          <li key={line.entityKey} className="flex justify-between gap-2">
            <span>{`${textField(line.after, 'name') ?? '(không tên)'} × ${numberField(line.after, 'qty') ?? '?'}`}</span>
            <span>{formatAmountOf(line.after)}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

export function ShopDetailScreen({ client, shopId }: { client: AdminClient; shopId: string }) {
  const [shop, setShop] = useState<ShopDetail | null>(null)
  const [tab, setTab] = useState<Tab>('orders')
  const [orders, setOrders] = useState<Paged>(EMPTY)
  const [lines, setLines] = useState<AdminDataRow[]>([])
  const [customers, setCustomers] = useState<Paged>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    client.loadShop(shopId).then(
      (detail) => live && setShop(detail),
      (caught: unknown) => live && setError(errorText(caught)),
    )
    void (async () => {
      try {
        const page = await client.loadData(shopId, 'orders', 0)
        if (!live) return
        setOrders({ rows: page.rows, next: page.next, loaded: true })
        const pageLines = await loadLinesFor(client, shopId, page.rows)
        if (live) setLines(pageLines)
      } catch (caught) {
        if (live) setError(errorText(caught))
      }
    })()
    return () => {
      live = false
    }
  }, [client, shopId])

  useEffect(() => {
    if (tab !== 'customers' || customers.loaded) return
    let live = true
    client.loadData(shopId, 'customers', 0).then(
      (page) => live && setCustomers({ rows: page.rows, next: page.next, loaded: true }),
      (caught: unknown) => live && setError(errorText(caught)),
    )
    return () => {
      live = false
    }
  }, [client, shopId, tab, customers.loaded])

  const loadMoreOrders = async () => {
    if (orders.next === null) return
    setBusy(true)
    try {
      const page = await client.loadData(shopId, 'orders', orders.next)
      setOrders((prev) => ({ rows: mergeRows(prev.rows, page.rows), next: page.next, loaded: true }))
      const pageLines = await loadLinesFor(client, shopId, page.rows)
      setLines((prev) => mergeRows(prev, pageLines))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const loadMoreCustomers = async () => {
    if (customers.next === null) return
    setBusy(true)
    try {
      const page = await client.loadData(shopId, 'customers', customers.next)
      setCustomers((prev) => ({ rows: mergeRows(prev.rows, page.rows), next: page.next, loaded: true }))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const linesByOrder = new Map<string, AdminDataRow[]>()
  for (const line of lines) {
    const orderId = orderIdOf(line)
    if (orderId === null) continue
    linesByOrder.set(orderId, [...(linesByOrder.get(orderId) ?? []), line])
  }

  return (
    <div>
      {shop ? <ShopBlock shop={shop} /> : <p className="px-4 py-4 text-muted">{`Đang đọc Sổ: ${shortId(shopId)}…`}</p>}
      <p className="px-4 text-[13px] text-muted">{LAG_NOTE}</p>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2 px-4 pt-3" role="group" aria-label="Dữ liệu sổ">
        {TABS.map((item) => (
          <Button
            key={item.key}
            variant={tab === item.key ? 'primary' : 'secondary'}
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="px-4 py-3">
        {tab === 'orders' ? (
          <>
            <ul className="divide-y divide-line">
              {orders.rows.map((order) => (
                <OrderItem key={order.entityKey} order={order} lines={linesByOrder.get(order.entityKey) ?? []} />
              ))}
            </ul>
            {orders.loaded && orders.rows.length === 0 ? <p className="text-muted">Chưa có đơn.</p> : null}
            {orders.next !== null ? (
              <Button variant="secondary" disabled={busy} onClick={() => void loadMoreOrders()}>
                Tải thêm
              </Button>
            ) : null}
          </>
        ) : null}

        {tab === 'customers' ? (
          <>
            <ul className="divide-y divide-line">
              {customers.rows.map((customer) => (
                <li key={customer.entityKey} data-entity-key={customer.entityKey} className="py-2">
                  <span className="font-semibold">{textField(customer.after, 'name') ?? '(đã xoá)'}</span>
                  <span className="block text-[13px] text-muted">
                    {[textField(customer.after, 'phone'), textField(customer.after, 'address')].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            {customers.loaded && customers.rows.length === 0 ? <p className="text-muted">Chưa có khách.</p> : null}
            {customers.next !== null ? (
              <Button variant="secondary" disabled={busy} onClick={() => void loadMoreCustomers()}>
                Tải thêm
              </Button>
            ) : null}
          </>
        ) : null}

        {tab === 'debts' ? (
          <>
            <ul className="divide-y divide-line">
              {(shop?.debts ?? []).map((debt) => (
                <li key={debt.customerGid} data-customer-gid={debt.customerGid} className="flex items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{debt.name ?? `Khách ${shortId(debt.customerGid)}`}</span>
                    <span className="block text-[13px] text-muted">{`${debt.orderCount} đơn · nợ từ ${formatAt(debt.oldestAt)}`}</span>
                  </span>
                  <MoneyText value={debt.total} />
                </li>
              ))}
            </ul>
            {shop && shop.debts.length === 0 ? <p className="text-muted">Không ai nợ.</p> : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
