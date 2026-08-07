import { NameListScreen } from './name-list-screen'
import { useExpenseCategoryRows } from './use-catalog'
import {
  createExpenseCategory,
  deleteExpenseCategory,
  updateExpenseCategory,
} from '@/db/repositories/expenses'

export function ExpenseCategoryPage() {
  const rows = useExpenseCategoryRows()

  return (
    <NameListScreen
      title="Loại chi phí"
      hint="Đặt tên theo cách bạn hay nói: Nguyên liệu, Thuê mặt bằng, Điện nước…"
      addLabel="Thêm loại"
      emptyMessage="Chưa có loại nào. Khoản chi không có loại vẫn ghi được, chỉ là báo cáo khó tách hơn."
      rows={rows}
      describeUsage={(usage) => (usage === 0 ? 'Chưa dùng' : `${usage} khoản chi`)}
      // Đổi tên thì sửa được, xoá thì mất luôn nhãn của những khoản chi cũ — không có đường lùi.
      blockDelete={(row) =>
        row.usage === 0
          ? null
          : `Đang có ${row.usage} khoản chi thuộc loại này. Đổi loại cho chúng trước rồi mới xoá được.`
      }
      confirmDelete={() => 'Loại này chưa được dùng ở khoản chi nào.'}
      onCreate={(name) => createExpenseCategory({ name })}
      onRename={(id, name) => updateExpenseCategory(id, { name })}
      onDelete={deleteExpenseCategory}
    />
  )
}
