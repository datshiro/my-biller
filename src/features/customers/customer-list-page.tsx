import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router'
import { useCustomerSummaries, useCustomers } from './use-customers'
import type { CustomerSummary } from '@/db/repositories/customers'
import { matchesCustomer } from '@/domain/customer-search'
import { formatAmount } from '@/domain/money'
import type { Customer } from '@/domain/schema'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { ListScreen } from '@/ui/list-screen'
import { SearchInput } from '@/ui/search-input'

function describe(customer: Customer, summary: CustomerSummary | undefined): string {
  const parts = [customer.phone.trim() || 'Chưa có SĐT']
  if (!summary || summary.orderCount === 0) {
    parts.push('chưa có đơn nào')
  } else {
    parts.push(`${summary.orderCount} đơn`)
    if (summary.lastSoldAt) parts.push(`gần nhất ${format(summary.lastSoldAt, 'dd/MM')}`)
  }
  return parts.join(' · ')
}

export function CustomerListPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const customers = useCustomers()
  const summaries = useCustomerSummaries()

  const filtered = useMemo(
    () => (customers ?? []).filter((customer) => matchesCustomer(customer, query)),
    [customers, query],
  )

  return (
    <ListScreen
      title="Khách hàng"
      count={customers ? `${customers.length} khách` : undefined}
      cta={
        <Button size="cta" onClick={() => void navigate('/them/khach-hang/moi')}>
          ＋ Thêm khách hàng
        </Button>
      }
    >
      {customers && customers.length > 0 ? (
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm tên hoặc số điện thoại…" />
      ) : null}

      {customers === undefined ? (
        <ListSkeleton />
      ) : customers.length === 0 ? (
        <EmptyState
          message="Chưa có khách hàng nào. Lưu khách quen để ghi nợ và xem lịch sử mua."
          actionLabel="＋ Thêm khách hàng"
          onAction={() => void navigate('/them/khach-hang/moi')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState message={`Không có khách nào khớp “${query.trim()}”.`} />
      ) : (
        <ul className="border-t border-line">
          {filtered.map((customer) => {
            const summary = summaries?.get(customer.id ?? -1)
            return (
              <li key={customer.id}>
                <ListRow
                  onClick={() => void navigate(`/them/khach-hang/${customer.id}`)}
                  title={customer.name}
                  subtitle={describe(customer, summary)}
                  right={
                    summary && summary.debt > 0 ? (
                      <>
                        <span className="money block font-semibold text-warn">{formatAmount(summary.debt)}</span>
                        <StatusChip tone="warn">Còn nợ</StatusChip>
                      </>
                    ) : (
                      <span className="text-[13px] text-muted">Không nợ</span>
                    )
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
    </ListScreen>
  )
}
