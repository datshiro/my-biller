import { useNavigate } from 'react-router'
import { useItemGroups, useItems, useOptionGroups } from '@/features/items/use-items'
import { placesUsing } from '@/domain/option-group-rules'
import type { OptionGroupRow } from '@/domain/schema'
import { Button } from '@/ui/button'
import { StatusChip } from '@/ui/chip'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { ListScreen } from '@/ui/list-screen'

function describe(group: OptionGroupRow, places: number): string {
  const parts =
    group.kind === 'choice'
      ? ['Tuỳ chọn', `${group.choices.length} lựa chọn`, (group.maxSelect ?? 1) > 1 ? `chọn tối đa ${group.maxSelect}` : 'chọn một']
      : ['Topping', `${group.toppings.length} món`, group.maxSelect ? `tối đa ${group.maxSelect} loại` : 'không giới hạn']
  if (group.required === 1) parts.push('bắt buộc')
  parts.push(places > 0 ? `gắn ${places} nơi` : 'chưa gắn')
  return parts.join(' · ')
}

export function OptionGroupListPage() {
  const navigate = useNavigate()
  const groups = useOptionGroups()
  const items = useItems()
  const itemGroups = useItemGroups()
  const loading = groups === undefined || items === undefined || itemGroups === undefined
  const openForm = (id?: number) => void navigate(id ? `/them/nhom-lua-chon/${id}` : '/them/nhom-lua-chon/moi')
  const ordered = [...(groups ?? [])].sort((a, b) => b.isActive - a.isActive || a.sortOrder - b.sortOrder)

  return (
    <ListScreen
      title="Nhóm lựa chọn"
      count={groups ? `${groups.length}` : undefined}
      cta={
        <Button size="cta" disabled={loading} onClick={() => openForm()}>
          ＋ Thêm nhóm lựa chọn
        </Button>
      }
    >
      <p className="px-4 py-3 text-[13px] text-muted">
        Tuỳ chọn (Đường, Mức đá, Ghi chú nhanh…) và topping dùng chung: tạo một lần, gắn vào món ở form món hoặc gắn vào
        cả nhóm món.
      </p>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : ordered.length === 0 ? (
        <EmptyState
          message="Chưa có nhóm lựa chọn nào. Bắt đầu từ mẫu Đường, Mức đá hay Ghi chú nhanh."
          actionLabel="＋ Thêm nhóm lựa chọn"
          onAction={() => openForm()}
        />
      ) : (
        <ul className="border-t border-line">
          {ordered.map((group) => (
            <li key={group.gid}>
              <ListRow
                onClick={() => openForm(group.id)}
                title={
                  <>
                    {group.name}
                    {group.isActive === 0 ? (
                      <>
                        {' '}
                        <StatusChip>Đã lưu trữ</StatusChip>
                      </>
                    ) : null}
                  </>
                }
                subtitle={describe(group, placesUsing(group.gid, { items, itemGroups }).length)}
                right={<span className="text-[20px] text-muted">›</span>}
              />
            </li>
          ))}
        </ul>
      )}
    </ListScreen>
  )
}
