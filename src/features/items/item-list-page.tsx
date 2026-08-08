import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useItemGroups, useItems } from './use-items'
import { formatAmount } from '@/domain/money'
import { normalizeName } from '@/domain/order-draft/parse-order-text'
import type { Item } from '@/domain/schema'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { ListScreen } from '@/ui/list-screen'
import { SearchInput } from '@/ui/search-input'

function describe(item: Item, groupName: string | undefined): string {
  const parts = [item.unit || 'Chưa đặt đơn vị']
  if (groupName) parts.push(groupName)
  parts.push(
    item.costPrice === null
      ? 'chưa có giá nhập'
      : `nhập ${formatAmount(item.costPrice)} · lãi ${formatAmount(item.unitPrice - item.costPrice)}`,
  )
  return parts.join(' · ')
}

export function ItemListPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const items = useItems()
  const groups = useItemGroups()

  const groupNames = useMemo(
    () => new Map((groups ?? []).map((group) => [group.id, group.name])),
    [groups],
  )

  const filtered = useMemo(() => {
    const keyword = normalizeName(query)
    if (!items || !keyword) return items ?? []
    return items.filter((item) => normalizeName(item.name).includes(keyword))
  }, [items, query])

  const openForm = (id?: number) => void navigate(id ? `/them/mat-hang/${id}` : '/them/mat-hang/moi')

  return (
    <ListScreen
      title="Mặt hàng"
      count={items ? `${items.length} món` : undefined}
      cta={
        <Button size="cta" onClick={() => openForm()}>
          ＋ Thêm mặt hàng
        </Button>
      }
    >
      {items && items.length > 0 ? (
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm mặt hàng…" />
      ) : null}

      {items === undefined ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          message="Chưa có mặt hàng nào. Thêm mặt hàng để bán nhanh hơn — chỉ cần tên và giá bán."
          actionLabel="＋ Thêm mặt hàng"
          onAction={() => openForm()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState message={`Không có mặt hàng nào khớp “${query.trim()}”.`} />
      ) : (
        <ul className="border-t border-line">
          {filtered.map((item) => (
            <li key={item.id}>
              <ListRow
                onClick={() => openForm(item.id)}
                title={
                  <>
                    {item.name}
                    {item.isActive === 0 ? (
                      <>
                        {' '}
                        <StatusChip>Ngừng bán</StatusChip>
                      </>
                    ) : null}
                  </>
                }
                subtitle={describe(item, groupNames.get(item.groupId ?? -1))}
                right={<span className="money font-semibold">{formatAmount(item.unitPrice)}</span>}
              />
            </li>
          ))}
        </ul>
      )}
    </ListScreen>
  )
}
