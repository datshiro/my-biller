import { ItemGroupOptionSheet } from './item-group-option-sheet'
import { NameListScreen } from './name-list-screen'
import { useItemGroupRows } from './use-catalog'
import { appendGroup, deleteGroup, updateGroup } from '@/db/repositories/items'

export function ItemGroupPage() {
  const rows = useItemGroupRows()

  return (
    <NameListScreen
      title="Nhóm mặt hàng"
      hint="Nhóm để lọc nhanh khi bán: Đồ uống, Đồ ăn, Thuốc lá… Mở một nhóm để gắn nhóm lựa chọn (tuỳ chọn, topping) cho mọi món trong nhóm."
      addLabel="Thêm nhóm"
      emptyMessage="Chưa có nhóm nào. Bán ít món thì không cần nhóm — thêm khi danh sách bắt đầu dài."
      rows={rows}
      describeUsage={(usage) => (usage === 0 ? 'Chưa có mặt hàng nào' : `${usage} mặt hàng`)}
      blockDelete={() => null}
      confirmDelete={(row) =>
        row.usage === 0
          ? 'Nhóm này đang trống.'
          : `${row.usage} mặt hàng trong nhóm sẽ về “chưa phân nhóm”. Hàng và phiếu cũ không mất gì.`
      }
      onCreate={appendGroup}
      onRename={(id, name) => updateGroup(id, { name })}
      onDelete={deleteGroup}
      extra={{
        label: 'Nhóm lựa chọn',
        sheet: (row, onClose) => <ItemGroupOptionSheet key={row.id} groupId={row.id} onClose={onClose} />,
      }}
    />
  )
}
